"use client";

import Link from "next/link";
import ui from "../lib/ui";

// Numbered card for one part of a form.
export function FormSection({ id, step, title, hint, children, aside }) {
  return (
    <section id={id} className="form-section" style={{ scrollMarginTop: "80px" }}>
      <div className="form-section-head">
        {step && <span className="form-step">{step}</span>}
        <div style={{ flex: 1 }}>
          <h2>{title}</h2>
          {hint && <p>{hint}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, hint, optional, children, wide }) {
  return (
    <div className="form-field" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <label style={ui.label}>
        {label}
        {optional && <span className="form-optional"> optional</span>}
      </label>
      {children}
      {hint && <div style={ui.help}>{hint}</div>}
    </div>
  );
}

// Tap-friendly choice buttons in place of a dropdown for short lists.
export function Choice({ value, onChange, options, name }) {
  return (
    <div className="choice-row" role="radiogroup" aria-label={name}>
      {options.map(([optionValue, label]) => (
        <button
          key={optionValue}
          type="button"
          role="radio"
          aria-checked={value === optionValue}
          className={`choice${value === optionValue ? " on" : ""}`}
          onClick={() => onChange(optionValue)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// Save bar that stays at the bottom of the screen on long forms.
export function StickyActions({ children, summary }) {
  return (
    <div className="sticky-actions">
      <div className="sticky-summary">{summary}</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>{children}</div>
    </div>
  );
}

export function PageHeader({ back, backLabel, title, intro }) {
  return (
    <div style={{ marginBottom: 20 }}>
      {back && (
        <Link href={back} style={ui.back}>
          ← {backLabel}
        </Link>
      )}
      <h1 style={{ fontSize: 30, margin: "0 0 4px" }}>{title}</h1>
      {intro && <p style={{ color: "var(--muted)", margin: 0 }}>{intro}</p>}
    </div>
  );
}
