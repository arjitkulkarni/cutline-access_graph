"use client";

import { useMemo } from "react";
import { ArrowRight, CircleCheck, KeyRound, Lock, MousePointerClick } from "lucide-react";
import { classifyAccess, type ContractIndex, riskKeySet } from "@/lib/contract";
import { groupRoutes, type HighlightPath } from "@/lib/graph/paths";
import type { Labeler } from "@/lib/labels";
import { isSensitive } from "@/lib/labels";
import { cn, joinNames, plural } from "@/lib/format";
import type { GraphResponse, GraphNode, PathsResponse, RiskFinding } from "@/lib/types";
import { ProvenanceChip } from "@/components/common/Meta";
import { Badge } from "@/components/ui/Badge";
import { Kbd } from "@/components/ui/CopyButton";
import { LoadingRows } from "@/components/ui/States";
import { FactList, InspectorHeader, InspectorSection, PropsTable } from "./parts";
import { RouteList } from "./RouteList";

function EntityLink({ id, label, onSelect }: { id: string; label: Labeler; onSelect: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onSelect(id)} className="text-[13px] text-fg underline-offset-2 hover:underline">
      {label.node(id)}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// Principal
// ---------------------------------------------------------------------------------------------

export function PrincipalInspector({
  node,
  graph,
  label,
  contract,
  findings,
  highlights,
  pathResults,
  pathsPending,
  activeRouteKey,
  onRoute,
  onSelectNode,
}: {
  node: GraphNode;
  graph: GraphResponse;
  label: Labeler;
  contract: ContractIndex;
  findings: RiskFinding[];
  highlights: HighlightPath[];
  pathResults: PathsResponse[];
  pathsPending: boolean;
  activeRouteKey: string | null;
  onRoute: (key: string | null) => void;
  onSelectNode: (id: string) => void;
}) {
  const roles = graph.edges.filter((e) => e.type === "ASSIGNED_TO" && e.source === node.id).map((e) => e.target);
  const guardrails = graph.guardrails.filter((g) => g.applies_to.includes(node.id));
  const workflows = graph.workflows.filter((w) => w.performers.includes(node.id));
  const riskKeys = useMemo(() => riskKeySet(findings), [findings]);
  const capabilities = graph.nodes.filter((n) => n.kind === "capability");

  const reachable = pathResults.filter((r) => r.allowed && r.principal === node.id);
  const unreachable = capabilities.filter((c) => pathResults.some((r) => r.capability === c.id && !r.allowed));

  return (
    <div className="flex flex-col">
      <InspectorHeader node={node} />

      <InspectorSection title="Assigned roles" count={roles.length}>
        <FactList
          empty="No direct role assignment."
          items={roles.map((r) => (
            <span key={r} className="flex items-center gap-1.5 text-xs text-fg-3">
              <ArrowRight size={12} aria-hidden />
              <EntityLink id={r} label={label} onSelect={onSelectNode} />
            </span>
          ))}
        />
      </InspectorSection>

      <InspectorSection title="Effective access" count={pathResults.length ? `${reachable.length} of ${capabilities.length}` : undefined}>
        {pathsPending && !pathResults.length ? (
          <LoadingRows rows={3} />
        ) : reachable.length ? (
          <div className="flex flex-col gap-3">
            {reachable.map((res, index) => {
              const tone = classifyAccess(node.id, res.capability, contract, riskKeys);
              const routes = groupRoutes(highlights.filter((h) => h.capability === res.capability));
              const startAt = reachable.slice(0, index).reduce((total, previous) => total + groupRoutes(highlights.filter((h) => h.capability === previous.capability)).length, 0);
              const allowPair = contract.allow.get(`${node.id}::${res.capability}`)?.[0];
              const denyPair = contract.deny.get(`${node.id}::${res.capability}`)?.[0];
              return (
                <div key={res.capability}>
                  <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <button
                      type="button"
                      onClick={() => onSelectNode(res.capability)}
                      className="mono text-[12px] text-fg hover:underline"
                    >
                      {res.capability}
                    </button>
                    <Badge tone={tone === "unwanted" ? "red" : tone === "required" ? "sage" : "neutral"}>
                      {tone === "unwanted" ? "Unwanted" : tone === "required" ? "Required" : "Permitted"}
                    </Badge>
                    {denyPair ? <ProvenanceChip source={denyPair.source} label={label} /> : allowPair ? <ProvenanceChip source={allowPair.source} label={label} /> : null}
                  </div>
                  <RouteList
                    routes={routes}
                    label={label}
                    activeRouteKey={activeRouteKey}
                    onToggle={onRoute}
                    showPrincipals={false}
                    letterOffset={startAt}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-fg-3">{pathResults.length === capabilities.length ? "This principal reaches no capability." : "Access has not been fully resolved. Check the query status below."}</p>
        )}
        {unreachable.length ? (
          <p className="mt-3 text-xs text-fg-3">
            No route to {joinNames(unreachable.map((c) => c.id))}.
          </p>
        ) : null}
      </InspectorSection>

      {guardrails.length || workflows.length ? (
        <InspectorSection title="Business intent">
          <div className="flex flex-col gap-2 text-xs text-fg-2">
            {guardrails.map((g) => (
              <div key={g.id} className="flex flex-col gap-1">
                <ProvenanceChip source={`guardrail:${g.id}`} label={label} className="self-start" />
                <span>{g.description}</span>
              </div>
            ))}
            {workflows.map((w) => (
              <div key={w.id} className="flex flex-wrap items-center gap-1.5">
                <ProvenanceChip source={`workflow:${w.id}`} label={label} />
                <span>requires {joinNames(w.requires)}</span>
              </div>
            ))}
          </div>
        </InspectorSection>
      ) : null}

      <PropsTable node={node} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Role
// ---------------------------------------------------------------------------------------------

export function RoleInspector({
  node,
  graph,
  label,
  findings,
  activeRouteKey,
  highlights,
  onRoute,
  onSelectNode,
}: {
  node: GraphNode;
  graph: GraphResponse;
  label: Labeler;
  findings: RiskFinding[];
  highlights: HighlightPath[];
  activeRouteKey: string | null;
  onRoute: (key: string | null) => void;
  onSelectNode: (id: string) => void;
}) {
  const members = graph.edges.filter((e) => e.type === "ASSIGNED_TO" && e.target === node.id).map((e) => e.source);
  const inheritedBy = graph.edges.filter((e) => e.type === "INHERITS" && e.target === node.id).map((e) => e.source);
  const inherits = graph.edges.filter((e) => e.type === "INHERITS" && e.source === node.id).map((e) => e.target);
  const grants = graph.edges.filter((e) => e.type === "GRANTS" && e.source === node.id).map((e) => e.target);
  const routes = groupRoutes(highlights);
  const principals = [...new Set(findings.filter((f) => f.paths.some((p) => p.nodes.includes(node.id))).map((f) => f.principal))];

  const linkList = (ids: string[], empty: string) => (
    <FactList empty={empty} items={ids.map((id) => <EntityLink key={id} id={id} label={label} onSelect={onSelectNode} />)} />
  );

  return (
    <div className="flex flex-col">
      <InspectorHeader node={node} />
      <div className="grid grid-cols-1 border-b border-line">
        <InspectorSection title="Assigned to" count={members.length} className="border-b-0">
          {linkList(members, "No principals")}
        </InspectorSection>
        <InspectorSection title="Grants" count={grants.length} className="border-b-0">
          <FactList
            empty="No direct grants"
            items={grants.map((g) => {
              const cap = graph.nodes.find((n) => n.id === g);
              return (
                <button key={g} type="button" onClick={() => onSelectNode(g)} className="mono inline-flex items-center gap-1 text-[12px] text-fg hover:underline">
                  {g}
                  {isSensitive(cap) ? <Lock size={10} className="text-fg-3" aria-label="restricted" /> : null}
                </button>
              );
            })}
          />
        </InspectorSection>
        <InspectorSection title="Inherits" count={inherits.length} className="border-b-0">
          {linkList(inherits, "Nothing")}
        </InspectorSection>
        <InspectorSection title="Inherited by" count={inheritedBy.length} className="border-b-0">
          {linkList(inheritedBy, "No roles")}
        </InspectorSection>
      </div>

      <InspectorSection
        title="On unwanted routes"
        tone={routes.length ? "red" : undefined}
        count={routes.length ? plural(routes.length, "route") : undefined}
      >
        {routes.length ? (
          <>
            <RouteList routes={routes} label={label} activeRouteKey={activeRouteKey} onToggle={onRoute} />
            <p className="mt-2 text-xs text-fg-3">Reached by {joinNames(principals.map((p) => label.node(p)))}.</p>
          </>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-fg-2">
            <CircleCheck size={13} className="text-sage" aria-hidden />
            No forbidden route passes through this role.
          </p>
        )}
      </InspectorSection>
      <PropsTable node={node} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Resource
// ---------------------------------------------------------------------------------------------

export function ResourceInspector({
  node,
  graph,
  label,
  onSelectNode,
}: {
  node: GraphNode;
  graph: GraphResponse;
  label: Labeler;
  onSelectNode: (id: string) => void;
}) {
  const caps = graph.edges.filter((e) => e.type === "ACTS_ON" && e.target === node.id).map((e) => e.source);
  return (
    <div className="flex flex-col">
      <InspectorHeader node={node} />
      <InspectorSection title="Capabilities acting on it" count={caps.length}>
        <FactList
          empty="No capability acts on this resource."
          items={caps.map((c) => {
            const cap = graph.nodes.find((n) => n.id === c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => onSelectNode(c)}
                className="flex w-full items-center gap-2 rounded-md border border-line bg-raised/40 px-2.5 py-1.5 text-left hover:border-line-strong"
              >
                <KeyRound size={13} className="text-fg-3" aria-hidden />
                <span className="text-[13px] text-fg">{label.node(c)}</span>
                <span className="mono text-[11px] text-fg-3">{c}</span>
                {isSensitive(cap) ? (
                  <Badge tone="amber" icon={Lock} className="ml-auto">
                    {String(cap?.props.sensitivity)}
                  </Badge>
                ) : null}
              </button>
            );
          })}
        />
      </InspectorSection>
      <PropsTable node={node} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Nothing selected
// ---------------------------------------------------------------------------------------------

export function InspectorEmpty({
  graph,
  findings,
  label,
  onSelectNode,
}: {
  graph: GraphResponse;
  findings: RiskFinding[];
  label: Labeler;
  onSelectNode: (id: string) => void;
}) {
  const sensitive = graph.nodes.filter((n) => n.kind === "capability" && (isSensitive(n) || findings.some((f) => f.capability === n.id)));
  return (
    <div className="flex flex-col">
      <div className="border-b border-line px-4 pb-4 pt-4">
        <p className="label-micro">Inspector</p>
        <h2 className="mt-1.5 text-base font-semibold tracking-[-0.01em] text-fg">Start from what must be protected</h2>
        <p className="mt-1 text-xs leading-[18px] text-fg-2">
          Select a capability to see every route that reaches it, who must keep access, and where those routes overlap.
        </p>
      </div>
      <InspectorSection title="Sensitive capabilities" count={sensitive.length}>
        {sensitive.length ? (
          <ul className="flex flex-col gap-1.5">
            {sensitive.map((cap) => {
              const capFindings = findings.filter((f) => f.capability === cap.id);
              const paths = capFindings.reduce((n, f) => n + f.paths.length, 0);
              return (
                <li key={cap.id}>
                  <button
                    type="button"
                    onClick={() => onSelectNode(cap.id)}
                    className="flex w-full items-start gap-2.5 rounded-lg border border-line bg-raised/40 px-3 py-2.5 text-left transition-colors hover:border-line-strong hover:bg-raised"
                  >
                    <KeyRound size={14} className={cn("mt-0.5 shrink-0", capFindings.length ? "text-amber" : "text-fg-3")} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-col items-start gap-0.5">
                        <span className="text-[13px] font-medium text-fg">{cap.label}</span>
                        <span className="mono text-[11px] text-fg-3">{cap.id}</span>
                      </span>
                      <span className={cn("mt-0.5 block text-xs", capFindings.length ? "text-amber/90" : "text-fg-3")}>
                        {capFindings.length
                          ? `${joinNames(capFindings.map((f) => label.node(f.principal)))} reach it against a guardrail · ${plural(paths, "path")}`
                          : "No unwanted access"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-xs text-fg-3">No capability is marked restricted in this graph.</p>
        )}
      </InspectorSection>
      <InspectorSection title="Navigate">
        <ul className="flex flex-col gap-1.5 text-xs text-fg-2">
          <li className="flex items-center gap-2">
            <Kbd>/</Kbd> Search principals, roles and capabilities
          </li>
          <li className="flex items-center gap-2">
            <Kbd>Tab</Kbd> Move between nodes · <Kbd>Enter</Kbd> select
          </li>
          <li className="flex items-center gap-2">
            <Kbd>Esc</Kbd> Clear the selection
          </li>
          <li className="flex items-center gap-2">
            <MousePointerClick size={13} className="text-fg-3" aria-hidden /> Drag to pan, scroll to zoom
          </li>
        </ul>
      </InspectorSection>
    </div>
  );
}
