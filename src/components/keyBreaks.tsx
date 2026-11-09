import React from 'react';

/**
 * Lets a long key break only right after an underscore, so the line never ends in the middle of a word:
 * "dearrow_random_frame_x" wraps as "dearrow_random_" / "frame_x". Works on plain strings and on the nodes
 * `highlightText` returns (its <mark> parts keep their highlight).
 */
export function breakAfterUnderscores(node: React.ReactNode): React.ReactNode {
  if (typeof node === 'string') {
    const parts = node.split(/(?<=_)/);
    if (parts.length <= 1) return node;
    return parts.map((p, i) => (
      <React.Fragment key={i}>
        {p}
        {i < parts.length - 1 && <wbr />}
      </React.Fragment>
    ));
  }
  if (Array.isArray(node)) return node.map((n, i) => <React.Fragment key={i}>{breakAfterUnderscores(n)}</React.Fragment>);
  if (React.isValidElement<{ children?: React.ReactNode }>(node) && node.props.children !== undefined) {
    return React.cloneElement(node, undefined, breakAfterUnderscores(node.props.children));
  }
  return node;
}
