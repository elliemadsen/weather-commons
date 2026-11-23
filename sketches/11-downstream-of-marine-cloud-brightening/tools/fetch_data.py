"""Download the Hirasawa et al. (2023) CESM2 marine cloud brightening files from Zenodo.

Record: https://zenodo.org/records/8384453 (CC BY 4.0)
Files go to ../assets/hirasawa2023/, which git ignores. Each file is checked against
the MD5 checksum Zenodo publishes. Files already present with the right checksum are skipped.

Run from the sketch folder:
    python3 tools/fetch_data.py            # precipitation, temperature and small extras
    python3 tools/fetch_data.py --only PRECT
"""
import argparse
import hashlib
import json
import pathlib
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

RECORD = "8384453"
HERE = pathlib.Path(__file__).resolve().parent
DEST = HERE.parent / "assets" / "hirasawa2023"

# Small files: grid, global means, tipping-point metrics, the authors' notebook.
EXTRAS = [
    "cam_gridinfo.nc",
    "cesm2_gmst_gmpr.zip",
    "tipping_points.zip",
    "Hirasawa et al., 2023 2023GL104314R.ipynb",
]


def wanted(key, only):
    if key in EXTRAS:
        return only is None
    if not key.endswith(".nc"):
        return False
    variables = [only] if only else ["PRECT", "TREFHT"]
    return any(f".{v}." in key for v in variables)


def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="one variable, e.g. PRECT")
    ap.add_argument("--parallel", type=int, default=4, help="files to download at once")
    args = ap.parse_args()

    DEST.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(f"https://zenodo.org/api/records/{RECORD}") as r:
        record = json.load(r)

    files = [f for f in record["files"] if wanted(f["key"], args.only)]
    total = sum(f["size"] for f in files) / 1e9
    print(f"{len(files)} files, {total:.2f} GB, into {DEST}")

    def get(f):
        out = DEST / f["key"]
        expected = f["checksum"].split(":", 1)[1]
        if out.exists() and md5(out) == expected:
            print("ok   ", f["key"], flush=True)
            return
        print("get  ", f["key"], f"{f['size'] / 1e6:.0f} MB", flush=True)
        tmp = out.with_suffix(out.suffix + ".part")
        for attempt in range(1, 21):
            try:
                have = tmp.stat().st_size if tmp.exists() else 0
                if have < f["size"]:
                    # Resume from what we already have; give up on a silent connection after 60 s.
                    req = urllib.request.Request(f["links"]["self"], headers={"Range": f"bytes={have}-"})
                    with urllib.request.urlopen(req, timeout=60) as r:
                        mode = "ab" if r.status == 206 else "wb"
                        with open(tmp, mode) as fh:
                            for chunk in iter(lambda: r.read(1 << 20), b""):
                                fh.write(chunk)
                if md5(tmp) == expected:
                    break
                print("      checksum mismatch, starting over", f["key"], flush=True)
                tmp.unlink()
            except OSError as err:  # network errors and timeouts; certificate checks stay on
                print(f"      attempt {attempt} interrupted for {f['key']}: {err}", flush=True)
            time.sleep(min(5 * attempt, 30))
        else:
            tmp.unlink(missing_ok=True)
            raise RuntimeError(f"could not download {f['key']}; run the script again later")
        tmp.rename(out)
        print("done ", f["key"], flush=True)

    # Zenodo is slow per connection, so fetch a few files at once.
    with ThreadPoolExecutor(max_workers=args.parallel) as pool:
        for result in pool.map(get, files):
            pass

    print("done")


if __name__ == "__main__":
    main()
