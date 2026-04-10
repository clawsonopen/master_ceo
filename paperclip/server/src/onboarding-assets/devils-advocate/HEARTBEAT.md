# HEARTBEAT.md

On each heartbeat:
1. Read pending strategic checkpoint payloads.
2. Evaluate logic consistency, context completeness, and risk.
3. Return one decision: approve, bounce, or escalate.
4. Attach a compact JSON handoff payload.
