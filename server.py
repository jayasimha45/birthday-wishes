import base64
import json
import os
import random
import re
import secrets
import threading
import time
import urllib.parse
import urllib.request
import uuid
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
PEOPLE_FILE = os.path.join(DATA_DIR, "people.json")
CONFIG_FILE = os.path.join(DATA_DIR, "config.json")
NOTIFIED_FILE = os.path.join(DATA_DIR, "notified.json")
USERS_FILE = os.path.join(DATA_DIR, "users.json")
SESSIONS_FILE = os.path.join(DATA_DIR, "sessions.json")
LOG_FILE = os.path.join(DATA_DIR, "notify.log")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)

for _f in (PEOPLE_FILE, NOTIFIED_FILE, USERS_FILE, SESSIONS_FILE):
    if not os.path.exists(_f):
        with open(_f, "w", encoding="utf-8") as f:
            json.dump([] if _f in (PEOPLE_FILE, USERS_FILE) else {}, f)

DEFAULT_CONFIG = {
    "whatsapp": {
        "enabled": False,
        "provider": "twilio",
        "account_sid": "",
        "auth_token": "",
        "from_number": "whatsapp:+14155238886",
        "recipients": [],
        "time": "09:00",
        "templates": {
            "birthday": {"content_sid": "", "content_variables": ""},
            "otp": {"content_sid": "", "content_variables": ""},
            "test": {"content_sid": "", "content_variables": ""},
        },
    },
    "google_oauth": {
        "enabled": False,
        "client_id": "",
        "client_secret": "",
        "redirect_uri": "http://localhost:8000/api/auth/google/callback",
    },
}

if not os.path.exists(CONFIG_FILE):
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(DEFAULT_CONFIG, f, ensure_ascii=False, indent=2)

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".json": "application/json; charset=utf-8",
}

DEFAULT = "application/octet-stream"

# OTP settings
OTP_VALID_MINUTES = 5
OTP_RESEND_SECONDS = 30
OTP_MAX_ATTEMPTS = 5
SESSION_DAYS = 30
GOOGLE_STATE_MINUTES = 10

otp_store = {}
google_states = {}


def load_people():
    try:
        with open(PEOPLE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return []


def save_people(people):
    with open(PEOPLE_FILE, "w", encoding="utf-8") as f:
        json.dump(people, f, ensure_ascii=False, indent=2)


def load_config():
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except (json.JSONDecodeError, OSError):
        cfg = {}
    if "whatsapp" not in cfg:
        cfg["whatsapp"] = DEFAULT_CONFIG["whatsapp"]
    if "google_oauth" not in cfg:
        cfg["google_oauth"] = DEFAULT_CONFIG["google_oauth"]
    return cfg


def save_config(cfg):
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def load_users():
    try:
        with open(USERS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return []


def save_users(users):
    with open(USERS_FILE, "w", encoding="utf-8") as f:
        json.dump(users, f, ensure_ascii=False, indent=2)


def load_sessions():
    try:
        with open(SESSIONS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def save_sessions(sessions):
    with open(SESSIONS_FILE, "w", encoding="utf-8") as f:
        json.dump(sessions, f, ensure_ascii=False, indent=2)


def load_notified():
    try:
        with open(NOTIFIED_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def save_notified(notified):
    keys = sorted(notified.keys())[-15:]
    pruned = {k: notified[k] for k in keys}
    with open(NOTIFIED_FILE, "w", encoding="utf-8") as f:
        json.dump(pruned, f, ensure_ascii=False, indent=2)


def log_notify(msg):
    line = datetime.now().strftime("%Y-%m-%d %H:%M:%S") + "  " + msg
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def valid_date(text):
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return False
    try:
        date.fromisoformat(text)
        return True
    except ValueError:
        return False


def valid_time(text):
    if not re.fullmatch(r"\d{2}:\d{2}", text):
        return False
    h, m = map(int, text.split(":"))
    return 0 <= h <= 23 and 0 <= m <= 59


def calc_age(dob):
    today = date.today()
    y, m, d = map(int, dob.split("-"))
    age = today.year - y
    if (today.month, today.day) < (m, d):
        age -= 1
    return age


PHOTO_MIMES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def send_json(handler, status, payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


def redirect(handler, location):
    handler.send_response(302)
    handler.send_header("Location", location)
    handler.send_header("Content-Length", "0")
    handler.end_headers()


# ---------------- WhatsApp (Twilio) ----------------

def normalize_wa_number(raw):
    n = str(raw or "").strip()
    if not n.startswith("whatsapp:"):
        n = "whatsapp:" + n
    return n


def valid_wa_number(n):
    return re.fullmatch(r"whatsapp:\+\d{1,15}", n) is not None

def twilio_send(wa_cfg, to_number, body=None, content_sid=None, content_variables=None):
    """
    POST /2010-04-01/Accounts/*/Messages.json with either:
      * a freeform "Body" (sandbox / free tier), or
      * an approved Message Template via ContentSid + ContentVariables (production WhatsApp).
    """
    sid = wa_cfg.get("account_sid", "")
    token = wa_cfg.get("auth_token", "")
    url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
    # Content templates take priority over freeform body (production requirement).
    if content_sid:
        form = {
            "From": normalize_wa_number(wa_cfg.get("from_number", "")),
            "To": to_number,
            "ContentSid": content_sid,
            "ContentVariables": json.dumps(content_variables or {}, ensure_ascii=False),
        }
    else:
        form = {
            "From": normalize_wa_number(wa_cfg.get("from_number", "")),
            "To": to_number,
            "Body": body or "",
        }
    payload = urllib.parse.urlencode(form).encode("utf-8")
    req = urllib.request.Request(url, data=payload)
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    req.add_header("Authorization", "Basic " + base64.b64encode(f"{sid}:{token}".encode()).decode())
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def twilio_send_with_error(wa_cfg, to_number, **kwargs):
    try:
        return twilio_send(wa_cfg, to_number, **kwargs), None
    except Exception as exc:
        return None, read_twilio_error(exc)



def send_whatsapp_message(wa_cfg, to_number, body):
    try:
        twilio_send(wa_cfg, to_number, body)
        return None
    except Exception as exc:
        detail = getattr(exc, "read", None)
        msg = str(exc)
        if detail:
            try:
                msg = json.loads(detail().decode("utf-8")).get("message", msg)
            except Exception:
                pass
        return msg


def send_birthday_whatsapp(wa_cfg, person):
    first = person["name"].split(" ")[0]
    age = calc_age(person["dob"])
    body = (
        f"🎂 Happy Birthday, {first}! 🎉\n"
        f"It's {person['name']}'s birthday today — they're turning {age}!\n"
        f"Send them a big birthday wish! 🎁"
    )
    errors = []
    for to in wa_cfg.get("recipients", []):
        err = send_whatsapp_message(wa_cfg, to, body)
        if err:
            errors.append(f"{to}: {err}")
    if errors:
        raise RuntimeError("; ".join(errors))


def send_whatsapp_test(wa_cfg):
    body = "🎉 Test WhatsApp message from the Birthday Club! Everything works — we'll notify you on birthdays. 🎂"
    errors = []
    for to in wa_cfg.get("recipients", []):
        err = send_whatsapp_message(wa_cfg, to, body)
        if err:
            errors.append(f"{to}: {err}")
    if errors:
        raise RuntimeError("; ".join(errors))


def send_otp_whatsapp(wa_cfg, phone_digits, code):
    body = f"🔐 Your Birthday Club OTP is {code}. It expires in {OTP_VALID_MINUTES} minutes."
    err = send_whatsapp_message(wa_cfg, normalize_wa_number("+" + phone_digits), body)
    if err:
        raise RuntimeError(err)


# ---------------- Auth ----------------

def normalize_phone(raw):
    digits = re.sub(r"[^\d]", "", str(raw or ""))
    if not (7 <= len(digits) <= 15):
        return None
    return digits


def display_phone(digits):
    if len(digits) <= 4:
        return "+" + digits
    return "+" + "*" * (len(digits) - 4) + digits[-4:]


def find_user_by_phone(users, digits):
    for u in users:
        if u.get("phone", "").replace("+", "") == digits:
            return u
    return None


def find_user_by_email(users, email):
    for u in users:
        if u.get("email", "").lower() == str(email or "").lower():
            return u
    return None


def public_user(user):
    if not user:
        return None
    return {
        "id": user.get("id"),
        "name": user.get("name"),
        "email": user.get("email"),
        "picture": user.get("picture"),
        "phone": user.get("phone"),
        "created": user.get("created"),
    }


def create_session(user_id):
    sessions = load_sessions()
    now = datetime.now()
    expired = [t for t, s in sessions.items() if datetime.fromisoformat(s.get("expires", "2000-01-01T00:00:00")) < now]
    for t in expired:
        sessions.pop(t, None)
    token = secrets.token_urlsafe(32)
    sessions[token] = {
        "user_id": user_id,
        "created": now.isoformat(timespec="seconds"),
        "expires": (now + timedelta(days=SESSION_DAYS)).isoformat(timespec="seconds"),
    }
    save_sessions(sessions)
    return token


def resolve_token(token):
    if not token:
        return None
    sessions = load_sessions()
    s = sessions.get(token)
    if not s:
        return None
    try:
        if datetime.fromisoformat(s.get("expires", "2000-01-01T00:00:00")) < datetime.now():
            del sessions[token]
            save_sessions(sessions)
            return None
    except ValueError:
        return None
    user = next((u for u in load_users() if u.get("id") == s.get("user_id")), None)
    return user


def auth_token_from(handler):
    auth = handler.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    parsed = urlparse(handler.path)
    qs = urllib.parse.parse_qs(parsed.query)
    return (qs.get("token", [""])[0]).strip()


def google_oauth_config(cfg):
    return cfg.get("google_oauth", {})


def user_by_or_create(data, **fields):
    users = load_users()
    user = None
    if fields.get("phone"):
        user = find_user_by_phone(users, fields["phone"])
    if not user and fields.get("email"):
        user = find_user_by_email(users, fields["email"])
    if not user:
        user = {"id": uuid.uuid4().hex[:12], "created": datetime.now().isoformat(timespec="seconds")}
        users.append(user)
    for k, v in fields.items():
        if v is not None:
            user[k] = v
    save_users(users)
    return user


# ---------------- Google OAuth ----------------

def google_auth_url(cfg, state):
    g = google_oauth_config(cfg)
    params = urllib.parse.urlencode({
        "client_id": g.get("client_id", ""),
        "redirect_uri": g.get("redirect_uri", ""),
        "response_type": "code",
        "scope": "openid email profile",
        "prompt": "select_account",
        "state": state,
    })
    return "https://accounts.google.com/o/oauth2/v2/auth?" + params


def google_exchange_code(code, g_cfg):
    data = urllib.parse.urlencode({
        "code": code,
        "client_id": g_cfg.get("client_id", ""),
        "client_secret": g_cfg.get("client_secret", ""),
        "redirect_uri": g_cfg.get("redirect_uri", ""),
        "grant_type": "authorization_code",
    }).encode("utf-8")
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=data)
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def google_userinfo(access_token):
    req = urllib.request.Request("https://www.googleapis.com/oauth2/v3/userinfo")
    req.add_header("Authorization", "Bearer " + access_token)
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


# ---------------- Config helpers ----------------

def birthdays_on(people, iso_date):
    _, m, d = iso_date.split("-")
    return [p for p in people if p.get("dob", "")[5:] == f"{m}-{d}"]


def config_public(cfg):
    w = cfg.get("whatsapp", {})
    g = cfg.get("google_oauth", {})
    notified = load_notified()
    today = date.today().isoformat()
    day = notified.get(today, {})
    if isinstance(day, list):
        day = {"whatsapp": []}
    wa_ids = set(day.get("whatsapp", []))
    all_people = load_people()
    by_id = {p.get("id"): p.get("name") for p in all_people}
    return {
        "ok": True,
        "whatsapp": {
            "enabled": bool(w.get("enabled")),
            "provider": w.get("provider", "twilio"),
            "account_sid": w.get("account_sid", ""),
            "auth_token_set": bool(w.get("auth_token", "")),
            "from_number": normalize_wa_number(w.get("from_number", "")),
            "recipients": w.get("recipients", []),
            "time": w.get("time", "09:00"),
        },
        "google_oauth": {
            "enabled": bool(g.get("enabled")),
            "client_id": g.get("client_id", ""),
            "client_secret_set": bool(g.get("client_secret", "")),
            "redirect_uri": g.get("redirect_uri", ""),
        },
        "wa_sent_today": [by_id.get(i) for i in wa_ids if by_id.get(i)],
    }


def split_recipients(raw):
    if isinstance(raw, list):
        raw = [str(x) for x in raw]
        return [x.strip() for x in raw if x.strip()]
    return [x.strip() for x in re.split(r"[,;\n]+", str(raw or "")) if x.strip()]


def save_config_from_payload(payload):
    w = payload.get("whatsapp", {}) if isinstance(payload, dict) else {}
    g = payload.get("google_oauth", {}) if isinstance(payload, dict) else {}
    cfg = load_config()
    old_w = cfg.get("whatsapp", {})
    old_g = cfg.get("google_oauth", {})

    new_w = {
        "enabled": bool(w.get("enabled")),
        "provider": "twilio",
        "account_sid": str(w.get("account_sid", "")).strip(),
        "auth_token": str(w.get("auth_token", "")) or old_w.get("auth_token", ""),
        "from_number": normalize_wa_number(w.get("from_number", "")),
        "recipients": [normalize_wa_number(r) for r in split_recipients(w.get("recipients", []))],
        "time": str(w.get("time", "09:00")).strip(),
    }
    if new_w["enabled"]:
        if not new_w["account_sid"]:
            return None, "Twilio Account SID is required."
        if not new_w["auth_token"]:
            return None, "Twilio Auth Token is required."
        if not valid_wa_number(new_w["from_number"]):
            return None, "WhatsApp sender number must look like whatsapp:+14155238886 (sandbox) or your Twilio number."
        if not new_w["recipients"]:
            return None, "Add at least one WhatsApp recipient number (e.g. +919876543210)."
        for r in new_w["recipients"]:
            if not valid_wa_number(r):
                return None, f"Invalid WhatsApp number: {r} (use international format, e.g. +919876543210)."
        if not valid_time(new_w["time"]):
            return None, "WhatsApp notification time must be HH:MM (24h)."

    new_g = {
        "enabled": bool(g.get("enabled")),
        "client_id": str(g.get("client_id", "")).strip() or old_g.get("client_id", ""),
        "client_secret": str(g.get("client_secret", "")).strip() or old_g.get("client_secret", ""),
        "redirect_uri": str(g.get("redirect_uri", "")).strip() or old_g.get("redirect_uri", "") or DEFAULT_CONFIG["google_oauth"]["redirect_uri"],
    }
    if new_g["enabled"]:
        if not new_g["client_id"]:
            return None, "Google OAuth Client ID is required."
        if not new_g["client_secret"]:
            return None, "Google OAuth Client Secret is required."
        if not new_g["redirect_uri"].startswith(("http://", "https://")):
            return None, "Google redirect URI must be a full URL (e.g. http://localhost:8000/api/auth/google/callback)."

    cfg["whatsapp"] = new_w
    cfg["google_oauth"] = new_g
    save_config(cfg)
    return cfg, None


# ---------------- HTTP handlers ----------------

class Handler(BaseHTTPRequestHandler):
    server_version = "BirthdayServer/1.0"

    def log_message(self, fmt, *args):
        pass

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length > 20 * 1024 * 1024:
            return None, "Payload too large (max 20 MB)"
        return self.rfile.read(length), None

    def _read_json(self):
        raw, err = self._read_body()
        if err:
            return None, None, err
        try:
            return json.loads(raw.decode("utf-8")), raw, None
        except (json.JSONDecodeError, UnicodeDecodeError):
            return None, None, "Invalid JSON"

    def _current_user(self):
        return resolve_token(auth_token_from(self))

    def do_GET(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)

        if path == "/api/people":
            return send_json(self, 200, {"ok": True, "people": load_people()})

        if path == "/api/config":
            return send_json(self, 200, config_public(load_config()))

        if path == "/api/auth/me":
            user = self._current_user()
            return send_json(self, 200, {"ok": True, "user": public_user(user)})

        if path == "/api/auth/google/start":
            cfg = load_config()
            g = google_oauth_config(cfg)
            if not (g.get("enabled") and g.get("client_id") and g.get("redirect_uri")):
                return send_json(self, 400, {"ok": False, "error": "Google sign-in is not configured yet (Settings → Google sign-in)."})
            state = secrets.token_urlsafe(16)
            google_states[state] = datetime.now()
            return redirect(self, google_auth_url(cfg, state))

        if path == "/api/auth/google/callback":
            self._handle_google_callback(parsed)
            return

        if path == "/":
            path = "/index.html"

        rel = path.lstrip("/")
        full = os.path.normpath(os.path.join(BASE_DIR, rel))
        if full != BASE_DIR and not full.startswith(BASE_DIR + os.sep):
            return send_json(self, 403, {"ok": False, "error": "Forbidden"})

        if not os.path.isfile(full):
            return send_json(self, 404, {"ok": False, "error": "Not found"})

        ext = os.path.splitext(full)[1].lower()
        ctype = MIME_TYPES.get(ext, DEFAULT)
        try:
            with open(full, "rb") as f:
                data = f.read()
        except OSError:
            return send_json(self, 500, {"ok": False, "error": "Read error"})

        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _handle_google_callback(self, parsed):
        qs = urllib.parse.parse_qs(parsed.query)
        state = (qs.get("state", [""])[0]).strip()
        if not state or datetime.now() - google_states.pop(state, datetime.now() - timedelta(hours=2)) > timedelta(minutes=GOOGLE_STATE_MINUTES):
            return redirect(self, "/?auth_error=1")
        if "error" in qs:
            return redirect(self, "/?auth_error=1")
        code = (qs.get("code", [""])[0]).strip()
        if not code:
            return redirect(self, "/?auth_error=1")
        cfg = load_config()
        g = google_oauth_config(cfg)
        try:
            token_data = google_exchange_code(code, g)
            access_token = token_data.get("access_token", "")
            info = google_userinfo(access_token) if access_token else {}
            if not info.get("sub") and not info.get("email"):
                return redirect(self, "/?auth_error=1")
            user = user_by_or_create(
                None,
                name=info.get("name"),
                email=info.get("email"),
                picture=info.get("picture"),
            )
            if info.get("sub"):
                user["google_sub"] = info["sub"]
                save_users(load_users())
            token = create_session(user["id"])
        except Exception as exc:
            log_notify("GOOGLE FAIL: " + str(exc))
            return redirect(self, "/?auth_error=1")
        return redirect(self, "/?token=" + urllib.parse.quote(token))

    def do_DELETE(self):
        parsed = urlparse(self.path)
        prefix = "/api/register/"
        if not parsed.path.startswith(prefix):
            return send_json(self, 404, {"ok": False, "error": "Not found"})
        person_id = unquote(parsed.path[len(prefix):])
        if not person_id:
            return send_json(self, 400, {"ok": False, "error": "Missing id"})

        people = load_people()
        removed = [p for p in people if p.get("id") == person_id]
        if not removed:
            return send_json(self, 404, {"ok": False, "error": "Person not found"})

        people = [p for p in people if p.get("id") != person_id]
        photo = removed[0].get("photo")
        if photo:
            p = os.path.normpath(os.path.join(BASE_DIR, photo))
            if p != BASE_DIR and p.startswith(BASE_DIR + os.sep) and os.path.isfile(p):
                try:
                    os.remove(p)
                except OSError:
                    pass
        save_people(people)
        send_json(self, 200, {"ok": True, "people": people})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/register":
            self._post_register()
        elif path == "/api/config":
            self._post_config()
        elif path == "/api/notify-test-whatsapp":
            self._post_notify_test_whatsapp()
        elif path == "/api/auth/otp-request":
            self._post_otp_request()
        elif path == "/api/auth/otp-verify":
            self._post_otp_verify()
        elif path == "/api/auth/logout":
            self._post_logout()
        else:
            send_json(self, 404, {"ok": False, "error": "Not found"})

    def _post_register(self):
        payload, _, err = self._read_json()
        if err:
            return send_json(self, 400, {"ok": False, "error": err})

        name = str(payload.get("name", "")).strip()
        dob = str(payload.get("dob", "")).strip()
        photo = payload.get("photo", "")

        if not name or len(name) > 100:
            return send_json(self, 400, {"ok": False, "error": "Please enter a valid name"})
        if not valid_date(dob):
            return send_json(self, 400, {"ok": False, "error": "Please enter a valid birth date (YYYY-MM-DD)"})

        user = self._current_user()

        person = {"id": uuid.uuid4().hex[:12], "name": name, "dob": dob}
        if user:
            person["user_id"] = user["id"]

        photo_path = None
        if isinstance(photo, str) and photo:
            match = re.fullmatch(r"data:(image/jpeg|image/png|image/webp|image/gif);base64,([A-Za-z0-9+/=]+)", photo)
            if not match:
                return send_json(self, 400, {"ok": False, "error": "Please upload a valid photo (JPEG, PNG, GIF or WEBP)"})
            mime, b64 = match.groups()
            try:
                blob = base64.b64decode(b64)
            except Exception:
                return send_json(self, 400, {"ok": False, "error": "Could not decode photo"})
            if len(blob) > 5 * 1024 * 1024:
                return send_json(self, 400, {"ok": False, "error": "Photo too large (max 5 MB)"})
            if not blob.startswith(b"\xff\xd8") and mime == "image/jpeg":
                return send_json(self, 400, {"ok": False, "error": "Photo does not look like a valid image"})
            filename = "person-" + person["id"] + PHOTO_MIMES[mime]
            with open(os.path.join(UPLOAD_DIR, filename), "wb") as f:
                f.write(blob)
            photo_path = "uploads/" + filename

        people = load_people()
        if user:
            old = [p for p in people if p.get("user_id") == user["id"]]
            for p in old:
                people.remove(p)
                if p.get("photo"):
                    fp = os.path.normpath(os.path.join(BASE_DIR, p["photo"]))
                    if fp != BASE_DIR and fp.startswith(BASE_DIR + os.sep) and os.path.isfile(fp) and fp != os.path.normpath(os.path.join(BASE_DIR, photo_path or "")):
                        try:
                            os.remove(fp)
                        except OSError:
                            pass
            if photo_path is None:
                # keep the old photo when updating without a new one
                if old and old[0].get("photo"):
                    photo_path = old[0]["photo"]
        if photo_path:
            person["photo"] = photo_path

        people.append(person)
        save_people(people)

        send_json(self, 201, {"ok": True, "person": person, "people": people, "user": public_user(user) if user else None})

    def _post_config(self):
        payload, _, err = self._read_json()
        if err:
            return send_json(self, 400, {"ok": False, "error": err})
        try:
            cfg, error = save_config_from_payload(payload)
        except (TypeError, ValueError):
            return send_json(self, 400, {"ok": False, "error": "Invalid settings values"})
        if error:
            return send_json(self, 400, {"ok": False, "error": error})
        send_json(self, 200, config_public(cfg))

    def _post_notify_test_whatsapp(self):
        cfg = load_config().get("whatsapp", {})
        if not cfg.get("account_sid") or not cfg.get("auth_token"):
            return send_json(self, 400, {"ok": False, "error": "Save your WhatsApp settings first (Settings → Save)."})
        if not cfg.get("recipients"):
            return send_json(self, 400, {"ok": False, "error": "Add at least one WhatsApp recipient number in Settings."})
        try:
            send_whatsapp_test(cfg)
        except Exception as exc:
            log_notify(f"WA TEST FAIL: {exc}")
            return send_json(self, 400, {"ok": False, "error": f"Test message failed: {exc}"})
        log_notify("WA TEST OK -> " + ", ".join(cfg.get("recipients", [])))
        send_json(self, 200, {"ok": True, "error": None})

    def _twilio_ready(self):
        cfg = load_config().get("whatsapp", {})
        if not (cfg.get("account_sid") and cfg.get("auth_token") and cfg.get("from_number")):
            return None, "WhatsApp sending isn't configured yet — open Settings and add your Twilio details first."
        return cfg, None

    def _post_otp_request(self):
        payload, _, err = self._read_json()
        if err:
            return send_json(self, 400, {"ok": False, "error": err})
        wa_cfg, e = self._twilio_ready()
        if e:
            return send_json(self, 400, {"ok": False, "error": e})

        digits = normalize_phone(payload.get("phone", ""))
        if not digits:
            return send_json(self, 400, {"ok": False, "error": "Enter a valid international number, e.g. +919876543210."})

        now = datetime.now()
        entry = otp_store.get(digits)
        if entry and entry.get("resend_at") and now < entry["resend_at"]:
            wait = int((entry["resend_at"] - now).total_seconds()) + 1
            return send_json(self, 400, {"ok": False, "error": f"Please wait {wait}s before requesting a new code."})

        code = f"{random.randint(0, 999999):06d}"
        try:
            send_otp_whatsapp(wa_cfg, digits, code)
        except Exception as exc:
            log_notify(f"OTP SEND FAIL {display_phone(digits)}: {exc}")
            return send_json(self, 400, {"ok": False, "error": f"Could not send OTP: {exc}"})

        otp_store[digits] = {
            "code": code,
            "expires": now + timedelta(minutes=OTP_VALID_MINUTES),
            "attempts": 0,
            "resend_at": now + timedelta(seconds=OTP_RESEND_SECONDS),
        }
        is_new = find_user_by_phone(load_users(), digits) is None
        log_notify(f"OTP SENT -> {display_phone(digits)}")
        send_json(self, 200, {"ok": True, "is_new": is_new, "otp_code": code, "error": None})

    def _post_otp_verify(self):
        payload, _, err = self._read_json()
        if err:
            return send_json(self, 400, {"ok": False, "error": err})
        digits = normalize_phone(payload.get("phone", ""))
        otp = str(payload.get("otp", "")).strip()
        if not digits or not otp:
            return send_json(self, 400, {"ok": False, "error": "Phone number and OTP are required."})

        entry = otp_store.get(digits)
        if not entry:
            return send_json(self, 400, {"ok": False, "error": "No code requested for this number. Send a new OTP."})
        if datetime.now() > entry["expires"]:
            otp_store.pop(digits, None)
            return send_json(self, 400, {"ok": False, "error": "This code has expired. Request a new one."})
        if entry["attempts"] >= OTP_MAX_ATTEMPTS:
            otp_store.pop(digits, None)
            return send_json(self, 400, {"ok": False, "error": "Too many wrong attempts. Request a new code."})

        if entry["code"] != otp:
            entry["attempts"] += 1
            left = OTP_MAX_ATTEMPTS - entry["attempts"]
            return send_json(self, 400, {"ok": False, "error": f"Wrong code. {left} attempt(s) left."})

        otp_store.pop(digits, None)
        is_new = find_user_by_phone(load_users(), digits) is None
        user = user_by_or_create(None, phone="+" + digits)
        token = create_session(user["id"])
        log_notify(f"LOGIN OK -> {display_phone(digits)} (new={is_new})")
        send_json(self, 200, {"ok": True, "token": token, "user": public_user(user), "is_new": is_new, "error": None})

    def _post_logout(self):
        token = auth_token_from(self)
        sessions = load_sessions()
        if token in sessions:
            del sessions[token]
            save_sessions(sessions)
        return send_json(self, 200, {"ok": True, "error": None})


# ---------------- Notifier ----------------

def whatsapp_ready(c):
    return (
        bool(c.get("enabled"))
        and bool(c.get("account_sid"))
        and bool(c.get("auth_token"))
        and bool(c.get("from_number"))
        and bool(c.get("recipients"))
    )


def notify_loop():
    while True:
        try:
            cfg = load_config()
            now = datetime.now()
            today = now.date().isoformat()
            now_hm = now.strftime("%H:%M")

            people = load_people()
            bdays = birthdays_on(people, today)
            if bdays:
                wa_cfg = cfg.get("whatsapp", {})
                target = str(wa_cfg.get("time", "09:00")).strip()
                if whatsapp_ready(wa_cfg) and now_hm == target:
                    notified = load_notified()
                    day = notified.setdefault(today, {})
                    if isinstance(day, list):
                        day = {"whatsapp": []}
                        notified[today] = day
                    sent = day.setdefault("whatsapp", [])
                    todo = [p for p in bdays if p.get("id") not in sent]
                    if todo:
                        try:
                            for p in todo:
                                send_birthday_whatsapp(wa_cfg, p)
                            sent.extend(p["id"] for p in todo)
                            save_notified(notified)
                            log_notify("WA SENT " + today + " -> " + ", ".join(p["name"] for p in todo))
                        except Exception as exc:
                            log_notify("WA FAIL " + today + ": " + str(exc))
        except Exception as exc:
            log_notify("LOOP ERROR: " + str(exc))
        time.sleep(30)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    threading.Thread(target=notify_loop, daemon=True).start()
    server = ThreadingHTTPServer(("", port), Handler)
    print(f"Birthday server running on http://localhost:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()