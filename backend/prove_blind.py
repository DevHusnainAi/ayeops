"""Check the Blind Clearance claim against AssemblyAI's own record of each session, not against our logs.

For every authorization it finds the code the operator read back, then searches everything the *model* was given or
produced -- system prompts and tool schemas, every tool call and result, every reply instruction, every agent turn --
for that code. The only place it may appear is the operator's own readback turn, after the operator said it.

    uv run prove_blind.py [incidents-dir]        # default: $INCIDENT_DIR or ./incidents
    uv run prove_blind.py --selftest              # proves the checker itself can fail

Exit status 1 if any code shows up anywhere the model could have read it before the operator spoke it."""
import json
import os
import re
import sys
from pathlib import Path

CODE_IN_REPORT = re.compile(r'authorized by the operator reading code "([a-z]+(?: [a-z]+)+)"')


def has(text, code):
    """The whole code, words in order, in one piece of text -- one common word alone (say, "lima") proves nothing."""
    pat = r"\b" + r"\W+".join(map(re.escape, code.split())) + r"\b"
    return bool(re.search(pat, text or "", re.I))


def model_side(turn):
    """Everything in one turn that came from the relay or the model -- i.e. not the operator's own speech."""
    return {"reply instruction": turn.get("requested_instructions"), "agent speech": turn.get("agent_text"),
            "tool call": json.dumps(turn.get("tool_calls") or [])}


def check(evidence, codes):
    """Returns (authorizations, first_heard_turn or None, leaks: list of str) for one session."""
    leaks = []
    heard_at = {}
    for code in codes:
        for i, turn in enumerate(evidence.get("turns", [])):
            if has(turn.get("user_transcript"), code):
                heard_at.setdefault(code, i)
            for where, text in model_side(turn).items():
                if has(text, code):
                    leaks.append(f'"{code}" in {where}, turn {i}')
        for j, change in enumerate(evidence.get("config_changes", [])):
            if has(json.dumps(change.get("update", {})), code):
                leaks.append(f'"{code}" in config change {j} (prompt / tools / keyterms)')
    return len(codes), heard_at, leaks


def sessions(directory):
    for report in sorted(Path(directory).glob("sess_*.md")):
        record = report.with_suffix(".json")
        codes = CODE_IN_REPORT.findall(report.read_text())
        if record.is_file() and codes:
            yield report.stem, json.loads(record.read_text()), codes


def selftest():
    evidence = {"turns": [{"agent_text": "Say lima papa now."}, {"user_transcript": "Roll back auth-service, lima, papa."}],
                "config_changes": [{"update": {"system_prompt": "the code is lima papa"}}]}
    n, heard, leaks = check(evidence, ["lima papa"])
    assert heard == {"lima papa": 1} and len(leaks) == 2, (heard, leaks)
    clean = {"turns": [{"agent_text": "Please read back the code."}, {"user_transcript": "lima, papa"}], "config_changes": []}
    assert check(clean, ["lima papa"])[2] == [], "a clean session must pass"
    assert not has("lima and charlie", "lima papa"), "one shared word is not the code"
    print("selftest ok: a code in the prompt or in agent speech is caught; a clean session passes")


def main():
    if "--selftest" in sys.argv:
        return selftest()
    directory = next((a for a in sys.argv[1:] if not a.startswith("-")), os.environ.get("INCIDENT_DIR", "incidents"))
    total = leaked = sessions_checked = 0
    scanned = 0
    for name, evidence, codes in sessions(directory):
        n, heard, leaks = check(evidence, codes)
        sessions_checked += 1
        total += n
        scanned += len(evidence.get("turns", [])) + len(evidence.get("config_changes", []))
        first = ", ".join(f'"{c}" first heard on turn {i} (operator)' for c, i in heard.items()) or "not found in operator speech"
        print(f"{'LEAK' if leaks else 'ok  '} {name}: {n} authorization(s); {first}")
        for leak in leaks:
            print(f"     {leak}")
        leaked += len(leaks)
    if not sessions_checked:
        print(f"no authorized sessions found in {directory}")
        return 2
    print(f"\n{sessions_checked} sessions, {total} authorizations, {scanned} turns and config changes searched: "
          f"{leaked} occurrence(s) of an approval code on the model's side")
    return 1 if leaked else 0


if __name__ == "__main__":
    sys.exit(main())
