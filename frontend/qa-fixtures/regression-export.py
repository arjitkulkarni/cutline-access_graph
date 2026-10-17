"""CUTLINE regression suite for repair rp_7c41e2d9 (QA fixture)."""

CASES = [
    ("test_maya_cannot_export_customers", "maya", "export_customers", "POST", "/demo/customers/export", 403, "guardrail:no_support_bulk_export"),
    ("test_noah_cannot_export_customers", "noah", "export_customers", "POST", "/demo/customers/export", 403, "guardrail:no_support_bulk_export"),
    ("test_dsar_bot_can_export_customers", "dsar_bot", "export_customers", "POST", "/demo/customers/export", 200, "workflow:dsar_fulfilment"),
    ("test_felix_can_export_customers", "felix", "export_customers", "POST", "/demo/customers/export", 200, "workflow:finance_close"),
    ("test_maya_can_generate_reports", "maya", "generate_reports", "GET", "/demo/reports", 200, "workflow:order_support"),
    ("test_maya_can_view_orders", "maya", "view_orders", "GET", "/demo/orders", 200, "workflow:order_support"),
    ("test_noah_can_generate_reports", "noah", "generate_reports", "GET", "/demo/reports", 200, "workflow:order_support"),
    ("test_noah_can_view_orders", "noah", "view_orders", "GET", "/demo/orders", 200, "workflow:order_support"),
    ("test_dsar_bot_can_generate_reports", "dsar_bot", "generate_reports", "GET", "/demo/reports", 200, "unchanged access"),
    ("test_dsar_bot_can_view_orders", "dsar_bot", "view_orders", "GET", "/demo/orders", 200, "unchanged access"),
    ("test_felix_cannot_generate_reports", "felix", "generate_reports", "GET", "/demo/reports", 403, "unchanged access"),
    ("test_felix_cannot_view_orders", "felix", "view_orders", "GET", "/demo/orders", 403, "unchanged access"),
]
