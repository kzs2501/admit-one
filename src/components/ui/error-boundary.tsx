"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "@/lib/monitoring";

interface ErrorBoundaryProps {
  /** Shown in place of the children once they've thrown. */
  fallback: ReactNode;
  children: ReactNode;
}

/**
 * Contains a render error to one part of the page, so the rest keeps working —
 * several small boundaries rather than one for the whole app (Bulletproof React).
 * Route segments get theirs from `error.tsx`; this is for parts of a layout, which no
 * `error.tsx` at the same level can catch. React still needs a class for this.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, { hasError: boolean }> {
  override state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, { source: "component", componentStack: info.componentStack });
  }

  override render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
