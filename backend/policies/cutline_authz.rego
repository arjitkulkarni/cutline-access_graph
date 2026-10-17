package cutline.authz

# Independent runtime decision for CUTLINE's synthetic Customer Ops API.
#
# input = {
#   "principal": "maya",
#   "capability": "export_customers",
#   "policy": {
#     "assignments": [{"user": "maya", "role": "support"}],
#     "inherits":    [{"child": "support", "parent": "shared_ops"}],   # child receives parent's grants
#     "grants":      [{"role": "shared_ops", "capability": "export_customers"}]
#   }
# }

default allow := false

all_roles contains a.role if some a in input.policy.assignments

all_roles contains e.child if some e in input.policy.inherits

all_roles contains e.parent if some e in input.policy.inherits

all_roles contains g.role if some g in input.policy.grants

# adjacency: role -> set of roles it inherits from
role_graph[r] := {p | some e in input.policy.inherits; e.child == r; p := e.parent} if some r in all_roles

assigned_roles contains a.role if {
	some a in input.policy.assignments
	a.user == input.principal
}

# transitive closure, cycle-safe
reached_roles := graph.reachable(role_graph, assigned_roles)

allow if {
	some g in input.policy.grants
	g.capability == input.capability
	g.role in reached_roles
}
