"""Dependency-free fixture checks. Run: python contracts/check.py.

The small schema walker covers only keywords used in understand.schema.json;
it is a fixture check, not the production API validator.
"""

import copy
import datetime as dt
import json
import math
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent


def load(name):
    return json.loads((ROOT / name).read_text())


def validate(value, schema):
    allowed_keywords = {"$schema", "title", "type", "additionalProperties", "required",
                        "properties", "enum", "items", "uniqueItems", "minimum",
                        "maximum", "minLength"}
    assert set(schema) <= allowed_keywords, "Extend fixture walker for new keywords"
    types = schema.get("type", [])
    types = [types] if isinstance(types, str) else types
    matches = {"object": isinstance(value, dict), "array": isinstance(value, list),
               "string": isinstance(value, str), "null": value is None,
               "boolean": type(value) is bool, "integer": type(value) is int}
    assert not types or any(matches[t] for t in types), (value, types)
    if "enum" in schema:
        assert value in schema["enum"], value
    if isinstance(value, dict):
        assert set(schema.get("required", [])) <= value.keys()
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            assert value.keys() <= properties.keys()
        for key, item in value.items():
            if key in properties:
                validate(item, properties[key])
    if isinstance(value, list):
        if schema.get("uniqueItems"):
            assert len({json.dumps(v, sort_keys=True) for v in value}) == len(value)
        for item in value:
            validate(item, schema["items"])
    if isinstance(value, str):
        assert len(value) >= schema.get("minLength", 0)
    if type(value) is int:
        assert schema.get("minimum", -math.inf) <= value <= schema.get("maximum", math.inf)


def expand_history(seed):
    """Decode compact seed into private canonical records; no stock mutations."""
    members = {m["id"]: m for m in seed["members"]}
    schedule = {(s["memberId"], s["slot"]): s for s in seed["schedule"]}
    records = []
    for day in seed["history"]:
        for member_id, member in members.items():
            for slot, code in zip(seed["historyEncoding"]["slots"], day[member_id]):
                if code == "-":
                    assert (member_id, slot) not in schedule
                    continue
                entry = schedule[member_id, slot]
                medicines = entry["medicines"]
                expected = sum(m["count"] for m in medicines)
                taken = medicines[:1] if code == "P" else medicines
                count = sum(m["count"] for m in taken) if code in "CRP" else 0
                local = dt.datetime.fromisoformat(day["date"] + "T" + entry["time"])
                utc = local + dt.timedelta(minutes=15 if code in "CRP" else 30, hours=-5.5)
                actor = "mini" if code == "R" else member.get("ownerUid", "server-call")
                actor = "server" if code in "UM" else actor
                source = "nurse" if code == "R" else "call" if member["mode"] == "keypad" else "tap"
                source = "checkin" if code in "UM" else source
                record = {"familyId": member["familyId"], "memberId": member_id,
                          "id": day["date"] + "_" + slot, "date": day["date"], "slot": slot,
                          "status": {"C": "confirmed", "R": "reported", "P": "partial",
                                     "U": "unknown", "M": "unknown"}[code],
                          "countTaken": count, "countExpected": expected,
                          "medicinesTaken": [m["id"] for m in taken] if count else [],
                          "source": source, "by": actor, "at": utc.isoformat() + "Z",
                          "attempts": 3 if code in "UM" else 1,
                          "evidence": [{"type": source, "by": actor, "at": utc.isoformat() + "Z",
                                        "snippet": "Synthetic historical fixture"}]}
                if code == "M":
                    record["outcome"] = "missed"
                    record["outcomeAudit"] = {"by": "server", "reason": "Synthetic explicit retrospective missed confirmation"}
                records.append(record)
    return records


def main():
    for path in ROOT.glob("*.json"):
        json.loads(path.read_text())
    schema = load("understand.schema.json")
    phrases = load("phrases.json")
    defaults = {"transcript": "", "intent": "unclear", "members": [], "slot": None,
                "count": None, "medicines": [], "snoozeReason": None, "messageTo": None,
                "messageText": None, "urgency": "normal", "needsClarification": False,
                "clarifyQuestion": None, "evidence": [], "sharingChanges": None, "memberActions": []}
    for row in phrases["cases"]:
        value = dict(defaults, transcript=row["transcript"], **row["expected"])
        if value["needsClarification"]:
            value["clarifyQuestion"] = "Please clarify."
        validate(value, schema)
        assert all(e["span"] in row["transcript"] for e in value["evidence"]), row["id"]
    negative = phrases["negativeEvidenceCase"]
    assert [e for e in negative["candidateEvidence"] if e["span"] in negative["transcript"]] == negative["expectedVerifiedEvidence"]
    # The walker must reject invalid count, intent and extra model output.
    for field, invalid in [("count", -1), ("intent", "prescribe"), ("extra", True)]:
        value = copy.deepcopy(defaults)
        value[field] = invalid
        try:
            validate(value, schema)
        except AssertionError:
            pass
        else:
            raise AssertionError(f"Accepted invalid {field}")
    replies = load("replies.json")["templates"]
    for key, reply in replies.items():
        assert reply["ml"] and reply["en"], key
        assert set(re.findall(r"\{(\w+)\}", reply["ml"])) == set(re.findall(r"\{(\w+)\}", reply["en"])), key
    assert {"confirmed", "reported", "partial", "pending", "unknown", "duplicate_blocked"} <= replies.keys()
    examples = [json.loads(block) for block in re.findall(r"```json\n(.*?)\n```", (ROOT / "api.md").read_text(), re.S)]
    for example in examples:
        assert {"request", "response"} <= example.keys()
        response = example["response"]
        if isinstance(response, str):
            ET.fromstring(response)
        if isinstance(response, dict) and "transcript" in response:
            validate(response, schema)
    seed = load("demo-family.json")
    dates = [dt.date.fromisoformat(d["date"]) for d in seed["history"]]
    assert len(dates) == 30 and len(set(dates)) == 30
    assert dates == [dates[0] + dt.timedelta(days=i) for i in range(30)]
    assert dates[-1] == dt.date.fromisoformat(seed["today"]) - dt.timedelta(days=1)
    for day in seed["history"]:
        for member in seed["members"]:
            assert len(day[member["id"]]) == 3
            assert set(day[member["id"]]) <= set("CRPUM-")
    records = expand_history(seed)
    assert len(records) == 240
    assert len({(r["familyId"], r["memberId"], r["id"]) for r in records}) == len(records)
    assert {r["status"] for r in records} == {"confirmed", "reported", "partial", "unknown"}
    families = {f["id"]: f for f in seed["families"]}
    for member in seed["members"]:
        assert member["id"] in families[member["familyId"]]["memberIds"]
        if member["id"] == "farhan":
            assert member["familyId"] != "demo-family"
    model = seed["model"]
    names = ["slot", "weekend", "nurseOnShift", "missRate7d", "responseDelay", "snoozes7d",
             "repeatedQuestions7d", "daysSinceDose", "lowStock", "unknowns7d"]
    assert model["featureNames"] == names
    assert len(model["weights"]) == 11 and len(model["featureMeans"]) == 10
    feature_doc = (ROOT / "risk-features.md").read_text()
    for i, name in enumerate(names):
        assert f"| {i} | {name} |" in feature_doc
    x = [0.5] * 10
    w, means = model["weights"], model["featureMeans"]
    z = w[0] + sum(a*b for a, b in zip(w[1:], x))
    baseline = w[0] + sum(a*b for a, b in zip(w[1:], means))
    deltas = [a*(b-c) for a, b, c in zip(w[1:], x, means)]
    assert math.isclose(baseline + sum(deltas), z, abs_tol=1e-12)
    print(f"OK: {len(examples)} API examples, {len(phrases['cases'])} phrases, {len(replies)} bilingual templates, 30 days / {len(records)} doses, 10 features / 11 weights")


if __name__ == "__main__":
    main()
