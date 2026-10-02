#!/usr/bin/env python3
"""
Curvelo dev-environment PostgreSQL setup.

The VM can be replaced at any time, wiping system packages (apt is also
unreliable here), so this script installs PostgreSQL 16 from manually
downloaded .debs and keeps the data directory inside the workspace
(./.pgdata) so databases survive VM replacement.

Idempotent: safe to re-run. Run:  python3 scripts/setup-postgres.py
Then:  sudo -u postgres /usr/lib/postgresql/16/bin/pg_ctl -D .pgdata -l .pgdata.log start
(or use scripts/pg-start.sh)
"""
import gzip
import os
import re
import subprocess
import sys
import time
import urllib.request

BASE = "http://archive.ubuntu.com/ubuntu"
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEB_DIR = "/tmp/curvelo-debs"
DATA_DIR = os.path.join(REPO_ROOT, ".pgdata")
WANT = ["postgresql-16"]  # closure resolved from here


def fetch(url, dest, retries=6):
    import gzip as _gzip

    os.makedirs(os.path.dirname(dest), exist_ok=True)

    def looks_complete(p):
        if not os.path.exists(p) or os.path.getsize(p) < 1000:
            return False
        try:
            with _gzip.open(p, "rt") as f:
                f.read(1)
            return True
        except Exception:
            return False

    if looks_complete(dest):
        return dest
    # stale partial file: start over
    if os.path.exists(dest):
        os.remove(dest)

    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "curl/8.5"})
            have = os.path.getsize(dest) if os.path.exists(dest) else 0
            if have:
                req.add_header("Range", f"bytes={have}-")
            with urllib.request.urlopen(req, timeout=90) as r, open(
                dest, "ab" if have and r.status == 206 else "wb"
            ) as f:
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)
            if looks_complete(dest) or os.path.getsize(dest) > 1000:
                return dest
        except Exception as e:  # noqa: BLE001
            print(f"    retry {attempt + 1}/{retries}: {e}")
            time.sleep(3)
    raise RuntimeError(f"failed to fetch {url}")


def load_index(url):
    dest = f"/tmp/curvelo-pkgs-{os.path.basename(url)}"
    fetch(url, dest)
    data = gzip.open(dest, "rt", errors="replace").read()
    pkgs = {}
    for chunk in data.split("\n\n"):
        m = re.match(r"^Package: (\S+)$", chunk, re.M)
        if not m:
            continue
        dm = re.search(r"^Depends: (.*?)(?=^[A-Z][A-Za-z-]*: |\Z)", chunk, re.M | re.S)
        fm = re.search(r"^Filename: (\S+)$", chunk, re.M)
        pkgs[m.group(1)] = {
            "file": fm.group(1) if fm else None,
            "deps": " ".join(dm.group(1).split()) if dm else "",
        }
    return pkgs


def installed():
    out = subprocess.run(
        ["dpkg-query", "-W", "-f=${Package}\n"], capture_output=True, text=True
    ).stdout
    return set(out.split())


def main():
    if os.path.exists("/usr/lib/postgresql/16/bin/postgres"):
        print("PostgreSQL 16 binaries already installed, skipping download.")
    else:
        print("Fetching package indexes...")
        pkgs = {}
        # noble main first, noble-updates overwrites (newer wins)
        for u in [
            f"{BASE}/dists/noble/main/binary-amd64/Packages.gz",
            f"{BASE}/dists/noble-updates/main/binary-amd64/Packages.gz",
        ]:
            for name, info in load_index(u).items():
                pkgs[name] = info
        have = installed()
        need, queue, missing = [], WANT[:], set()
        seen = set()
        while queue:
            name = queue.pop()
            if name in seen or name in have:
                continue
            seen.add(name)
            info = pkgs.get(name)
            if not info or not info["file"]:
                missing.add(name)
                continue
            need.append(name)
            for part in info["deps"].split(","):
                alts = [
                    re.sub(r"\s*\(.*?\)", "", a).strip().split(":")[0]
                    for a in part.split("|")
                ]
                alts = [a for a in alts if a]
                if not alts or any(a in have or a in seen for a in alts):
                    continue
                chosen = next((a for a in alts if a in pkgs and pkgs[a]["file"]), None)
                if chosen:
                    queue.append(chosen)
                else:
                    missing.add("/".join(alts))
        if missing:
            print("UNRESOLVED:", sorted(missing))
            sys.exit(1)
        print(f"Downloading {len(need)} packages...")
        debs = []
        for name in need:
            url = f"{BASE}/{pkgs[name]['file']}"
            dest = os.path.join(DEB_DIR, os.path.basename(url))

            def valid_deb(p):
                return (
                    subprocess.run(
                        ["dpkg-deb", "--info", p], capture_output=True
                    ).returncode
                    == 0
                )

            if not (os.path.exists(dest) and valid_deb(dest)):
                if os.path.exists(dest):
                    os.remove(dest)  # stale partial
                print(f"  {os.path.basename(dest)}")
                fetch(url, dest)
                if not valid_deb(dest):
                    sys.exit(f"downloaded deb failed validation: {dest}")
            debs.append(dest)
        print("Installing...")
        r = subprocess.run(["sudo", "dpkg", "-i"] + debs, capture_output=True, text=True)
        if r.returncode != 0:
            print(r.stdout[-1500:])
            print(r.stderr[-1500:])
            sys.exit("dpkg failed")

    # Data directory: the Debian default cluster (/var/lib/postgresql).
    # NOTE: the workspace filesystem forbids chown, so the data dir cannot
    # live in ~/workspace — dev data is ephemeral across VM replacements,
    # but this script recreates role + databases idempotently.
    print("Starting PostgreSQL cluster...")
    subprocess.run(["pg_createcluster", "16", "main"], capture_output=True)
    subprocess.run(["pg_ctlcluster", "16", "main", "start"], check=False)
    time.sleep(2)
    # Create role + databases via the unix socket (peer auth as postgres OS user).
    def psql_admin(sql):
        return subprocess.run(
            ["sudo", "-u", "postgres", "/usr/lib/postgresql/16/bin/psql",
             "-d", "postgres", "-tA", "-c", sql],
            check=False, capture_output=True, text=True, timeout=30,
        )

    psql_admin(
        "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='curvelo') "
        "THEN CREATE USER curvelo WITH PASSWORD 'curvelo_dev' CREATEDB; END IF; END $$;"
    )
    existing_dbs = psql_admin(
        "SELECT datname FROM pg_database;"
    ).stdout.split()
    for dbname in ("curvelo_dev", "curvelo_test"):
        if dbname not in existing_dbs:
            r = psql_admin(f"CREATE DATABASE {dbname} OWNER curvelo;")
            if r.returncode != 0:
                print(f"WARNING: could not create {dbname}: {r.stderr.strip()}")
        else:
            print(f"database {dbname} exists")
    r = subprocess.run(
        ["/usr/lib/postgresql/16/bin/psql",
         "-h", "localhost", "-U", "curvelo", "-d", "curvelo_dev",
         "-c", "SELECT 1"],
        capture_output=True, text=True, timeout=30,
        env={**os.environ, "PGPASSWORD": "curvelo_dev"},
    )
    print("PostgreSQL ready." if r.returncode == 0 else f"WARNING: connectivity check failed:\n{r.stderr}")


if __name__ == "__main__":
    main()
