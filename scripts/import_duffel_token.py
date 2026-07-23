"""Import Duffel token from existing YouFly project into control-tower + Vercel."""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

SRC = Path(
    r"C:\Users\vadim\Desktop\FOLDERS FROM DESCKTOP\03 - COD & PROIECTE\DEV\youfly\.env"
)
OUT = Path(r"C:\Users\vadim\youfly-clone")
LOCAL_ENV = OUT / ".env.local"
CREDS = OUT / ".duffel-creds.json"


def main() -> None:
    text = SRC.read_text(encoding="utf-8", errors="replace")
    tokens = re.findall(r"duffel_(?:test|live)_[A-Za-z0-9_\-]+", text)
    if not tokens:
        # try key=value
        for line in text.splitlines():
            if "DUFFEL" in line and "=" in line and "duffel_" in line:
                tokens.append(line.split("=", 1)[1].strip().strip('"').strip("'"))
    if not tokens:
        raise SystemExit("No Duffel token found in source .env")

    # Prefer test for free sandbox; else live
    test = [t for t in tokens if t.startswith("duffel_test_")]
    live = [t for t in tokens if t.startswith("duffel_live_")]
    token = (test or live)[0]
    kind = "test" if token.startswith("duffel_test_") else "live"
    print(f"Using {kind} token prefix={token[:20]}… len={len(token)}")

    # write local env (gitignored)
    existing = ""
    if LOCAL_ENV.exists():
        existing = LOCAL_ENV.read_text(encoding="utf-8")
    lines = [ln for ln in existing.splitlines() if not ln.startswith("DUFFEL_ACCESS_TOKEN=")]
    lines.append(f"DUFFEL_ACCESS_TOKEN={token}")
    LOCAL_ENV.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    print("Wrote", LOCAL_ENV)

    CREDS.write_text(
        json.dumps(
            {
                "email": "vadimpatrascu@gmail.com",
                "token_kind": kind,
                "token_prefix": token[:20],
                "token_len": len(token),
                "source": str(SRC),
                "note": "Token imported from existing YouFly project",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    # probe API without printing token
    import urllib.request

    req = urllib.request.Request(
        "https://api.duffel.com/places/suggestions?query=KIV",
        headers={
            "Authorization": f"Bearer {token}",
            "Duffel-Version": "v2",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode()
            print("Duffel probe HTTP", r.status, "body_len", len(body))
            print("probe_ok", True)
    except Exception as e:
        print("Duffel probe FAIL", e)
        # still continue to set env; user may need regenerate

    # set on Vercel production
    # vercel env add NAME production < value
    ps = subprocess.run(
        [
            "cmd",
            "/c",
            f'echo {token}| npx --yes vercel@latest env add DUFFEL_ACCESS_TOKEN production',
        ],
        cwd=str(OUT),
        capture_output=True,
        text=True,
        timeout=120,
    )
    print("vercel env add stdout:", ps.stdout[-500:] if ps.stdout else "")
    print("vercel env add stderr:", (ps.stderr or "")[-800:])
    print("vercel env add code", ps.returncode)

    # also try vercel env pull
    print("Token saved. Redeploy separately.")


if __name__ == "__main__":
    main()
