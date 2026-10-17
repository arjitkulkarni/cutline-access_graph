from tests.conftest import ok


def pairs(items):
    return {(c["principal"], c["capability"]) for c in items}


def test_demo_requirement_is_parsed_into_a_typed_contract(harness):
    text = ("Remove raw customer export from support. Preserve support order lookup and reporting. "
            "Preserve finance export.")
    body = ok(harness.client.post("/api/contract/parse", json={"text": text}))
    assert pairs(body["contract"]["must_deny"]) == {("maya", "export_customers"), ("noah", "export_customers")}
    assert pairs(body["contract"]["must_allow"]) == {
        ("maya", "view_orders"), ("maya", "generate_reports"), ("noah", "view_orders"), ("noah", "generate_reports"),
        ("felix", "export_customers")}
    assert any("service identities" in n for n in body["notes"])
    assert body["parser"] == "rules" and body["unresolved"] == []


def test_pronouns_carry_the_previous_subject(harness):
    body = ok(harness.client.post("/api/contract/parse", json={
        "text": "Noah must not export customers but keep their reports"}))
    assert pairs(body["contract"]["must_deny"]) == {("noah", "export_customers")}
    assert pairs(body["contract"]["must_allow"]) == {("noah", "generate_reports")}


def test_unresolvable_clauses_are_reported_not_guessed(harness):
    body = ok(harness.client.post("/api/contract/parse", json={"text": "Make everything secure."}))
    assert body["contract"]["must_deny"] == [] and body["unresolved"] == ["Make everything secure"]
