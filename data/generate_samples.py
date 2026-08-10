#!/usr/bin/env python3
"""
Generate sample deliverables for the CanSat GCS:
  - sample_telemetry_log.txt : raw $CSAT lines exactly as the radio emits them
  - sample_session.csv       : the parsed CSV the GCS "Export CSV" button produces

The checksum and 4-digit error-code logic here MIRROR js/parser.js (CONTRACT §1,§3)
so these files are a faithful reference AND a cross-language check of the contract.
Run:  py data/generate_samples.py
"""
import os

OUT = os.path.dirname(os.path.abspath(__file__))
LAT0, LON0 = 13.0827, 80.2707


def checksum(body: str) -> str:
    chk = 0
    for c in body:
        chk ^= ord(c)
    return f"{chk:02X}"


def build_packet(f) -> str:
    body = "CSAT," + ",".join(str(x) for x in f)
    return f"${body}*{checksum(body)}"


def error_code(state, descent, gps_fix, sep, chute) -> str:
    d1 = 1 if (state == 3 and not (8 <= descent <= 10)) else 0
    d2 = 0 if gps_fix else 1
    d3 = 1 if (state >= 3 and not sep) else 0
    d4 = 1 if chute else 0
    return f"{d1}{d2}{d3}{d4}"


# ── Synthetic flight (5 Hz, dt = 0.2 s) ────────────────────────────
def flight(scenario="nominal"):
    """Yield dicts of physical values for a full flight.

    scenario:
      nominal      — textbook flight, descent 9 m/s, GPS locked, clean sep
      fault        — descent 16 m/s (d1), GPS lost mid-flight (d2), sep fails (d3)
    """
    dt = 0.2
    t = 0.0
    alt = 0.0
    vel = 0.0
    state = 0
    sep = 0
    chute = 0
    seq = 0
    descent_vel = -16.0 if scenario == "fault" else -9.0
    while True:
        # phase machine
        if state == 0:
            if t > 2: state, vel = 1, 28.0
        elif state == 1:
            vel = 28.0
            if alt >= 380: state, vel = 2, 0.0
        elif state == 2:
            sep = 0 if scenario == "fault" else 1     # separation failure
            state, vel = 3, descent_vel
        elif state == 3:
            if alt < 15: state, vel = 4, -2.0
        elif state == 4:
            if alt <= 0.5: state, vel, alt = 5, 0.0, 0.0

        alt = max(0.0, alt + vel * dt)
        up = vel > 0
        press = 1013.25 * (1 - alt * 0.0000225577) ** 5.25588
        temp = 25 - alt * 0.0065
        batV = 3.9 - seq * 0.0002
        # GPS lost for a mid-flight window in the fault scenario.
        gps_fix = 0 if (scenario == "fault" and 8.0 < t < 16.0) else 1
        lat = LAT0 + ((seq % 7) - 3) * 0.00002 if gps_fix else 0.0
        lon = LON0 + ((seq % 5) - 2) * 0.00002 if gps_fix else 0.0
        az = 1.6 if up else 1.0
        spin = 40 if state >= 3 else 3

        yield {
            "seq": seq, "alt": alt, "temp": temp, "press": press,
            "lat": lat, "lon": lon, "gpsAlt": alt, "gpsFix": gps_fix,
            "ax": 0.02, "ay": -0.01, "az": az,
            "gx": (seq % 9 - 4) * spin / 9.0,
            "gy": (seq % 6 - 3) * spin / 6.0,
            "gz": (seq % 4 - 2) * spin / 4.0,
            "batV": batV, "state": state, "sep": sep, "chute": chute,
            "t": t,
        }
        seq += 1
        t += dt
        if state == 5:
            break


CSV_HEADER = ("timestamp_ms,seq,altitude_m,temp_c,pressure_hpa,lat,lon,gps_alt_m,"
              "gps_fix,ax_g,ay_g,az_g,gx_dps,gy_dps,gz_dps,battery_v,mission_state,"
              "payload_sep,parachute,descent_rate_mps,error_code")


def build_capture(scenario):
    """Return (raw_lines, csv_rows) for one flight scenario."""
    raw_lines, csv_rows = [], []
    prev_alt, prev_t = None, None
    ts = 1_769_000_000_000  # fixed epoch ms base for reproducibility

    for d in flight(scenario):
        fields = [
            d["seq"],
            f'{d["alt"]:.1f}', f'{d["temp"]:.1f}', f'{d["press"]:.1f}',
            f'{d["lat"]:.6f}', f'{d["lon"]:.6f}', f'{d["gpsAlt"]:.1f}', d["gpsFix"],
            f'{d["ax"]:.3f}', f'{d["ay"]:.3f}', f'{d["az"]:.3f}',
            f'{d["gx"]:.2f}', f'{d["gy"]:.2f}', f'{d["gz"]:.2f}',
            f'{d["batV"]:.2f}', d["state"], d["sep"], d["chute"],
        ]
        raw_lines.append(build_packet(fields))

        # descent rate = (prevAlt - alt) / dt   (CONTRACT §3)
        now = ts + int(d["t"] * 1000)
        if prev_alt is None:
            descent = 0.0
        else:
            descent = (prev_alt - d["alt"]) / ((now - prev_t) / 1000.0)
        prev_alt, prev_t = d["alt"], now

        code = error_code(d["state"], descent, d["gpsFix"], d["sep"], d["chute"])
        csv_rows.append([
            now, d["seq"], f'{d["alt"]:.1f}', f'{d["temp"]:.1f}', f'{d["press"]:.1f}',
            f'{d["lat"]:.6f}', f'{d["lon"]:.6f}', f'{d["gpsAlt"]:.1f}', d["gpsFix"],
            f'{d["ax"]:.3f}', f'{d["ay"]:.3f}', f'{d["az"]:.3f}',
            f'{d["gx"]:.2f}', f'{d["gy"]:.2f}', f'{d["gz"]:.2f}',
            f'{d["batV"]:.2f}', d["state"], d["sep"], d["chute"],
            f'{descent:.2f}', code,
        ])
    return raw_lines, csv_rows


def write_capture(raw_name, csv_name, banner, raw_lines, csv_rows):
    with open(os.path.join(OUT, raw_name), "w", newline="\n", encoding="utf-8") as fh:
        fh.write(banner + "\n")
        fh.write("\n".join(raw_lines) + "\n")
    with open(os.path.join(OUT, csv_name), "w", newline="\n", encoding="utf-8") as fh:
        fh.write(CSV_HEADER + "\n")
        for row in csv_rows:
            fh.write(",".join(str(x) for x in row) + "\n")
    faults = sum(1 for r in csv_rows if r[-1] != "0000")
    print(f"  {csv_name:26} {len(csv_rows):4} rows, {faults:4} non-nominal error codes")


def main():
    # 1) Textbook flight — every error digit stays 0.
    nom_raw, nom_csv = build_capture("nominal")
    write_capture(
        "sample_telemetry_log.txt", "sample_session.csv",
        "# CanSat raw downlink capture - 18-field format, NOMINAL flight",
        nom_raw, nom_csv)

    # 2) Fault demo — fast descent (d1), GPS-loss window (d2), sep failure (d3).
    flt_raw, flt_csv = build_capture("fault")
    write_capture(
        "sample_telemetry_fault_log.txt", "sample_session_fault.csv",
        "# CanSat raw downlink capture - 18-field format, FAULT-INJECTION demo",
        flt_raw, flt_csv)

    print("Done. Import either CSV in the GCS, or replay a .txt log line-by-line.")


if __name__ == "__main__":
    main()
