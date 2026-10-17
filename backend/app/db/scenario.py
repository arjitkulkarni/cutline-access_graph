"""The Customer Operations scenario: a realistic case of RBAC role bloat.

Story: Export Helper was attached to the Support role so the DSAR bot could fulfil data-subject
export requests. Support also inherits Shared Ops, which Finance relies on for exports. As a result
every human support agent can bulk-export customer data through two independent paths, and the two
"obvious" fixes each break a legitimate workflow (Finance close, DSAR fulfilment).
"""

from __future__ import annotations

from typing import Any

SCENARIO_ID = "customer-ops"
SCENARIO_NAME = "Customer Operations"
SCENARIO_DESCRIPTION = (
    "Support agents inherit bulk customer export through two role paths. Finance and the DSAR bot "
    "legitimately depend on the same roles."
)

NODES: dict[str, list[dict[str, Any]]] = {
    "User": [
        {"id": "maya", "name": "Maya Chen", "department": "support", "principal_type": "human", "title": "Support agent"},
        {"id": "noah", "name": "Noah Patel", "department": "support", "principal_type": "human", "title": "Support agent"},
        {"id": "felix", "name": "Felix Romero", "department": "finance", "principal_type": "human", "title": "Finance analyst"},
        {"id": "dsar_bot", "name": "DSAR Bot", "department": "support", "principal_type": "service",
         "title": "Fulfils data-subject access requests"},
    ],
    "Role": [
        {"id": "support", "name": "Support", "description": "Front-line customer support", "origin": "idp"},
        {"id": "shared_ops", "name": "Shared Ops", "description": "Operations bundle shared by Support and Finance",
         "origin": "idp"},
        {"id": "export_helper", "name": "Export Helper",
         "description": "Attached to Support so the DSAR bot could export customer records", "origin": "idp"},
        {"id": "finance", "name": "Finance", "description": "Finance operations", "origin": "idp"},
    ],
    "Capability": [
        {"id": "view_orders", "name": "View orders", "sensitivity": "internal", "method": "GET", "endpoint": "/demo/orders"},
        {"id": "generate_reports", "name": "Generate reports", "sensitivity": "internal", "method": "GET",
         "endpoint": "/demo/reports"},
        {"id": "export_customers", "name": "Export customers", "sensitivity": "restricted", "method": "POST",
         "endpoint": "/demo/customers/export"},
    ],
    "Resource": [
        {"id": "orders", "name": "Orders", "classification": "internal"},
        {"id": "reports", "name": "Reports", "classification": "internal"},
        {"id": "customer_records", "name": "Customer records", "classification": "restricted"},
    ],
    "Workflow": [
        {"id": "order_support", "name": "Order support", "criticality": "high",
         "description": "Agents look up orders and produce ticket reports"},
        {"id": "finance_close", "name": "Finance close", "criticality": "high",
         "description": "Month-end reconciliation needs a customer export"},
        {"id": "dsar_fulfilment", "name": "DSAR fulfilment", "criticality": "high",
         "description": "Legal obligation: export a customer's data on request"},
    ],
    "Guardrail": [
        {"id": "no_support_bulk_export",
         "description": "Support agents must not bulk-export customer records"},
    ],
}

EDGES: dict[str, list[tuple[str, str]]] = {
    "ASSIGNED_TO": [("maya", "support"), ("noah", "support"), ("dsar_bot", "support"), ("felix", "finance")],
    "INHERITS": [("support", "shared_ops"), ("support", "export_helper"), ("finance", "shared_ops")],
    "GRANTS": [
        ("support", "view_orders"),
        ("support", "generate_reports"),
        ("shared_ops", "export_customers"),
        ("export_helper", "export_customers"),
    ],
    "ACTS_ON": [("view_orders", "orders"), ("generate_reports", "reports"), ("export_customers", "customer_records")],
    "REQUIRES": [
        ("order_support", "view_orders"),
        ("order_support", "generate_reports"),
        ("finance_close", "export_customers"),
        ("dsar_fulfilment", "export_customers"),
    ],
    "PERFORMS": [("maya", "order_support"), ("noah", "order_support"), ("felix", "finance_close"),
                 ("dsar_bot", "dsar_fulfilment")],
    "FORBIDS": [("no_support_bulk_export", "export_customers")],
    "APPLIES_TO": [("no_support_bulk_export", "maya"), ("no_support_bulk_export", "noah")],
}

# Named live-challenge mutations (demo mode only). Each is expressed as allowlisted edits so it goes
# through the same guarded writer as a repair.
MUTATIONS: dict[str, dict[str, str]] = {
    "contractor_tools": {
        "title": "Attach a Contractor Tools bundle (grants export_customers) to Maya's role",
        "principal": "maya",
    },
    "direct_export_helper": {
        "title": "Assign Noah directly to Export Helper",
        "principal": "noah",
    },
}
