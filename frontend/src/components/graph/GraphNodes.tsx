"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/format";
import { isSensitive } from "@/lib/labels";
import type { ColumnFlowNode, EntityFlowNode } from "@/lib/graph/view";
import { entityIcon } from "@/components/common/Entity";

/** Custom node for principals, roles, capabilities and resources. */
export const EntityNode = memo(function EntityNode({ data, selected }: NodeProps<EntityFlowNode>) {
  const { node, tone, dimmed, presence, badge, focused } = data;
  const sensitive = node.kind === "capability" && isSensitive(node);
  // Restricted capabilities wear a lock glyph instead of a trailing icon, so labels keep their width.
  const Icon = sensitive ? Lock : entityIcon(node.kind, node);
  return (
    <div
      className={cn(
        "cl-node",
        `cl-node--${node.kind}`,
        tone && `cl-node--${tone}`,
        selected && "is-selected",
        dimmed && "is-dimmed",
        focused && "is-focused",
        presence !== "present" && `is-${presence}`,
      )}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className="cl-node__glyph">
        <Icon size={13} strokeWidth={1.9} aria-hidden />
      </span>
      <span className="cl-node__content">
        <span className="cl-node__label">{node.label}</span>
        <span className="cl-node__type">{node.kind === "user" ? (node.props.principal_type === "service" ? "Service identity" : "Principal") : node.kind === "capability" ? (sensitive ? "Restricted capability" : "Capability") : node.kind === "role" ? "Role" : "Resource"}</span>
      </span>
      {sensitive ? <span className="sr-only">(restricted)</span> : null}
      {badge ? <span className="cl-node__badge">{badge}</span> : null}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
});

/** Column header that pans and zooms with the graph. */
export const ColumnNode = memo(function ColumnNode({ data }: NodeProps<ColumnFlowNode>) {
  return (
    <div className="cl-column" aria-hidden>
      <span>{data.label}</span>
      <span className="cl-column__count">{data.count}</span>
    </div>
  );
});
