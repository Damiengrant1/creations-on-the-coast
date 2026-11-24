"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import ui from "../../lib/ui";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

function todayString() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

function money(value) {
  return `£${Number(value || 0).toFixed(2)}`;
}

function statusLabel(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function EventsPage() {
  const [events, setEvents] = useState([]);
  const [series, setSeries] = useState([]);
  const [performance, setPerformance] = useState([]);
  const [eventName, setEventName] = useState("");
  const [startDate, setStartDate] = useState(todayString());
  const [endDate, setEndDate] = useState("");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState("upcoming");
  const [seriesId, setSeriesId] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");

  useEffect(() => { loadData(); }, []);

  async function loadData({ keepMessage = false } = {}) {
    setLoading(true);
    if (!keepMessage) {
      setMessage("");
      setMessageType("");
    }

    const [eventsResult, seriesResult, performanceResult] = await Promise.all([
      supabase.from("events").select("id, event_series_id, event_name, start_date, end_date, location, status, notes").order("start_date", { ascending: false }),
      supabase.from("event_series").select("id, name, notes").order("name"),
      supabase.from("event_performance").select("event_id, event_series_id, event_name, start_date, end_date, location, total_sales, total_product_cost, gross_profit, total_expenses, net_profit"),
    ]);

    const error = eventsResult.error || seriesResult.error || performanceResult.error;
    if (error) {
      setMessage(`Could not load events: ${error.message}`);
      setMessageType("error");
      setLoading(false);
      return;
    }

    setEvents(eventsResult.data || []);
    setSeries(seriesResult.data || []);
    setPerformance(performanceResult.data || []);
    setLoading(false);
  }

  const performanceByEvent = useMemo(
    () => new Map(performance.map((item) => [item.event_id, item])),
    [performance]
  );

  const seriesNames = useMemo(
    () => new Map(series.map((item) => [item.id, item.name])),
    [series]
  );

  const totals = useMemo(
    () => performance.reduce((sum, item) => ({
      sales: sum.sales + Number(item.total_sales || 0),
      expenses: sum.expenses + Number(item.total_expenses || 0),
      profit: sum.profit + Number(item.net_profit || 0),
    }), { sales: 0, expenses: 0, profit: 0 }),
    [performance]
  );

  async function saveEvent(event) {
    event.preventDefault();
    setMessage("");
    setMessageType("");

    if (endDate && endDate < startDate) {
      setMessage("The end date cannot be before the start date.");
      setMessageType("error");
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("events").insert({
      event_name: eventName.trim(),
      start_date: startDate,
      end_date: endDate || null,
      location: location.trim() || null,
      status,
      event_series_id: seriesId || null,
      notes: notes.trim() || null,
    });

    if (error) {
      setMessage(`Could not create event: ${error.message}`);
      setMessageType("error");
      setSaving(false);
      return;
    }

    setEventName("");
    setStartDate(todayString());
    setEndDate("");
    setLocation("");
    setStatus("upcoming");
    setSeriesId("");
    setNotes("");
    setMessage("Event created successfully.");
    setMessageType("success");
    setSaving(false);
    await loadData({ keepMessage: true });
  }

  async function changeStatus(eventId, newStatus) {
    setMessage("");
    setMessageType("");
    const { error } = await supabase.from("events").update({ status: newStatus }).eq("id", eventId);
    if (error) {
      setMessage(`Could not update event: ${error.message}`);
      setMessageType("error");
      return;
    }
    setMessage("Event status updated.");
    setMessageType("success");
    await loadData({ keepMessage: true });
  }

  const fieldStyle = { ...ui.field };
  const labelStyle = { ...ui.label };

  return (
    <main style={{ ...ui.page }}>
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        <Link href="/" style={ui.back}>← Home</Link>
        <h1 style={{ fontSize: "30px", margin: "0 0 8px" }}>Events</h1>
        <p style={{ color: "var(--muted)", margin: "0 0 26px" }}>Create events and track their sales, costs, expenses and profit.</p>

        {message && <div style={{ padding: "14px 16px", marginBottom: "20px", borderRadius: "9px", background: messageType === "error" ? "var(--coral-soft)" : "var(--leaf-soft)", color: messageType === "error" ? "#9b2c17" : "var(--leaf)", border: `1px solid ${messageType === "error" ? "#f1c1c1" : "#bfe2c8"}`, fontWeight: "600" }}>{message}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "16px", marginBottom: "22px" }}>
          <SummaryCard title="Events" value={events.length} />
          <SummaryCard title="Event Sales" value={money(totals.sales)} />
          <SummaryCard title="Event Expenses" value={money(totals.expenses)} />
          <SummaryCard title="Event Net Profit" value={money(totals.profit)} featured />
        </div>

        <form onSubmit={saveEvent} style={{ ...ui.card, marginBottom: "24px" }}>
          <h2 style={{ marginTop: 0 }}>Add Event</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px", marginBottom: "18px" }}>
            <Field label="Event Name" labelStyle={labelStyle}><input value={eventName} onChange={(e) => setEventName(e.target.value)} style={fieldStyle} required /></Field>
            <Field label="Start Date" labelStyle={labelStyle}><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={fieldStyle} required /></Field>
            <Field label="End Date" labelStyle={labelStyle}><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate} style={fieldStyle} /></Field>
            <Field label="Location" labelStyle={labelStyle}><input value={location} onChange={(e) => setLocation(e.target.value)} style={fieldStyle} placeholder="Optional" /></Field>
            <Field label="Status" labelStyle={labelStyle}><select value={status} onChange={(e) => setStatus(e.target.value)} style={fieldStyle}><option value="upcoming">Upcoming</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></Field>
            <Field label="Event Series" labelStyle={labelStyle}><select value={seriesId} onChange={(e) => setSeriesId(e.target.value)} style={fieldStyle}><option value="">No series</option>{series.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          </div>
          <Field label="Notes" labelStyle={labelStyle}><textarea rows="3" value={notes} onChange={(e) => setNotes(e.target.value)} style={fieldStyle} /></Field>
          <button type="submit" disabled={saving} style={{ width: "100%", padding: "15px", marginTop: "20px", border: "none", borderRadius: "9px", background: saving ? "var(--muted)" : "var(--sea)", color: "#fff", fontSize: "16px", fontWeight: "700", cursor: saving ? "not-allowed" : "pointer" }}>{saving ? "Creating Event..." : "Create Event"}</button>
        </form>

        {loading ? <div style={cardStyle}>Loading events...</div> : events.length === 0 ? <div style={cardStyle}>No events created yet.</div> : (
          <div style={{ display: "grid", gap: "16px" }}>
            {events.map((event) => {
              const figures = performanceByEvent.get(event.id) || {};
              return <section key={event.id} style={cardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
                  <div><h2 style={{ margin: "0 0 7px" }}>{event.event_name}</h2><div style={{ color: "var(--muted)" }}>{event.start_date}{event.end_date ? ` to ${event.end_date}` : ""} · {event.location || "No location"}</div>{event.event_series_id && <div style={{ color: "var(--muted)", marginTop: "5px", fontSize: "14px" }}>Series: {seriesNames.get(event.event_series_id) || "Unknown"}</div>}</div>
                  <select value={event.status} onChange={(e) => changeStatus(event.id, e.target.value)} style={{ ...fieldStyle, width: "150px", height: "44px" }}><option value="upcoming">Upcoming</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: "12px", marginTop: "18px" }}>
                  <Figure label="Sales" value={money(figures.total_sales)} />
                  <Figure label="Direct Cost" value={money(figures.total_product_cost)} />
                  <Figure label="Gross Profit" value={money(figures.gross_profit)} />
                  <Figure label="Expenses" value={money(figures.total_expenses)} />
                  <Figure label="Net Profit" value={money(figures.net_profit)} strong />
                </div>
                {event.notes && <div style={{ marginTop: "15px", color: "var(--muted)" }}>{event.notes}</div>}
              </section>;
            })}
          </div>
        )}
      </div>
    </main>
  );
}

const cardStyle = { ...ui.card };
function Field({ label, labelStyle, children }) { return <div><label style={labelStyle}>{label}</label>{children}</div>; }
function SummaryCard({ title, value, featured }) { return <div style={{ ...cardStyle, background: featured ? "var(--ink)" : "#fff", color: featured ? "#fff" : "var(--ink)" }}><div style={{ color: featured ? "var(--line-strong)" : "var(--muted)", fontSize: "14px", marginBottom: "8px" }}>{title}</div><div style={{ fontSize: "28px", fontWeight: "700" }}>{value}</div></div>; }
function Figure({ label, value, strong }) { return <div style={{ padding: "14px", background: strong ? "var(--leaf-soft)" : "var(--sand)", borderRadius: "9px" }}><div style={{ color: "var(--muted)", fontSize: "13px", marginBottom: "6px" }}>{label}</div><strong style={{ fontSize: "19px", color: strong ? "var(--leaf)" : "var(--ink)" }}>{value}</strong></div>; }
