"""Trigger Duffel password reset for existing account."""
from __future__ import annotations

import json
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path(r"C:\Users\vadim\youfly-clone")
EMAIL = "vadimpatrascu@gmail.com"


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page.goto("https://app.duffel.com/sign-in", wait_until="load", timeout=60000)
        time.sleep(2)
        for label in ["Allow all", "Accept"]:
            try:
                page.get_by_role("button", name=label).click(timeout=1500)
            except Exception:
                pass
        # forgot password
        try:
            page.get_by_text("forgotten", exact=False).click(timeout=5000)
        except Exception:
            page.goto("https://app.duffel.com/forgot-password", wait_until="load")
        time.sleep(2)
        print("URL", page.url)
        print("BODY", page.inner_text("body")[:800].replace("\n", " | "))
        for sel in ['input[type="email"]', 'input[name="email"]', "input"]:
            el = page.query_selector(sel)
            if el and (el.get_attribute("type") in (None, "email", "text")):
                try:
                    page.fill(sel, EMAIL)
                    break
                except Exception:
                    pass
        page.screenshot(path=str(OUT / "duffel-forgot.png"))
        for name in ["Send", "Reset", "Continue", "Submit", "Email me"]:
            try:
                page.get_by_role("button", name=name).click(timeout=2000)
                print("clicked", name)
                break
            except Exception:
                pass
        else:
            page.keyboard.press("Enter")
        time.sleep(5)
        print("AFTER", page.url)
        print(page.inner_text("body")[:1000].replace("\n", " | "))
        page.screenshot(path=str(OUT / "duffel-forgot-after.png"))
        browser.close()


if __name__ == "__main__":
    main()
