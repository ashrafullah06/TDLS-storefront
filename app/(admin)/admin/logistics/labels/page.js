"use client";
// app/(admin)/admin/logistics/labels/page.js
import React, { useEffect, useMemo, useState } from "react";

const providers = [
  { id: "ecourier", name: "eCourier (BD)" },
  { id: "pathao", name: "Pathao Courier (BD)" },
  { id: "redx", name: "REDX (BD)" },
  { id: "steadfast", name: "Steadfast (BD)" },
  { id: "paperfly", name: "Paperfly (BD)" },
];

const Field = ({ label, children }) => (
  <label className="block mb-3">
    <div className="text-sm font-medium mb-1">{label}</div>
    <div>{children}</div>
  </label>
);

export default function LabelsPage() {
  const [provider, setProvider] = useState(providers[0].id);

  // common inputs
  const [form, setForm] = useState({
    // recipient
    recipient_name: "", recipient_phone: "", address: "",
    city: "", thana: "", area: "", zip: "",
    // amounts
    cod_amount: "", weight: "", items: "1",
    // merchant/invoice
    merchant_invoice_id: "",
    // pathao specific
    city_id: "", zone_id: "", area_id: "",
    // steadfast specific
    note: "",
    // paperfly specific
    customerThana: "", customerDistrict: "", pickMerchantName: "", pickMerchantAddress: "", pickMerchantThana: "", pickMerchantDistrict: "", pickupMerchantPhone: "", productBrief: "", packagePrice: "", max_weight: "",
    // pathao store
    store_id: "",
  });

  const [cities, setCities] = useState([]);
  const [zones, setZones] = useState([]);
  const [areas, setAreas] = useState([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [trackId, setTrackId] = useState("");
  const [track, setTrack] = useState(null);

  const needsEcourierMeta = provider === "ecourier";
  const needsPathaoMeta = provider === "pathao";

  // load metadata
  useEffect(() => {
    setCities([]); setZones([]); setAreas([]);
    if (needsEcourierMeta) {
      fetch("/api/logistics/meta/ecourier/cities").then(r => r.json()).then(setCities).catch(console.error);
    }
    if (needsPathaoMeta) {
      fetch("/api/logistics/meta/pathao/cities").then(r => r.json()).then(setCities).catch(console.error);
    }
  }, [provider]);

  async function onCityChange(v) {
    setForm(s => ({ ...s, city: v, city_id: v, thana: "", zone_id: "", area: "", area_id: "" }));
    setZones([]); setAreas([]);
    if (needsEcourierMeta && v) {
      fetch(`/api/logistics/meta/ecourier/thanas?city=${encodeURIComponent(v)}`).then(r => r.json()).then(setZones).catch(console.error);
    }
    if (needsPathaoMeta && v) {
      fetch(`/api/logistics/meta/pathao/zones?city_id=${encodeURIComponent(v)}`).then(r => r.json()).then(setZones).catch(console.error);
    }
  }
  async function onZoneChange(v) {
    setForm(s => ({ ...s, thana: v, zone_id: v, area: "", area_id: "" }));
    setAreas([]);
    if (needsEcourierMeta && v) {
      fetch(`/api/logistics/meta/ecourier/areas?city=${encodeURIComponent(form.city)}&thana=${encodeURIComponent(v)}`).then(r => r.json()).then(setAreas).catch(console.error);
    }
    if (needsPathaoMeta && v) {
      fetch(`/api/logistics/meta/pathao/areas?zone_id=${encodeURIComponent(v)}`).then(r => r.json()).then(setAreas).catch(console.error);
    }
  }

  const submitDisabled = useMemo(() => {
    if (!form.recipient_name || !form.recipient_phone) return true;
    if (provider === "ecourier" && (!form.city || !form.thana || !form.area || !form.zip)) return true;
    if (provider === "pathao" && (!form.store_id || !form.city_id || !form.zone_id || !form.area_id)) return true;
    return false;
  }, [provider, form]);

  async function createLabel(e) {
    e.preventDefault();
    setBusy(true); setResult(null);
    try {
      let payload = {};
      if (provider === "ecourier") {
        payload = {
          recipient_name: form.recipient_name,
          recipient_mobile: form.recipient_phone,
          recipient_city: form.city,
          recipient_thana: form.thana,
          recipient_area: form.area,
          recipient_address: form.address,
          package_code: "#2505", // you can also fetch packages via /packages if needed
          product_price: Number(form.cod_amount || 0),
          payment_method: "COD",
          recipient_zip: form.zip,
          parcel_type: "BOX",
          number_of_item: Number(form.items || 1),
        };
      } else if (provider === "pathao") {
        payload = {
          store_id: String(form.store_id),
          merchant_order_id: form.merchant_invoice_id || undefined,
          sender_name: "", sender_phone: "",
          recipient_name: form.recipient_name,
          recipient_phone: form.recipient_phone,
          address: form.address,
          city_id: Number(form.city_id), zone_id: Number(form.zone_id), area_id: Number(form.area_id),
          item_quantity: Number(form.items || 1),
          item_weight: Number(form.weight || 1),
          amount_to_collect: Number(form.cod_amount || 0),
          item_description: "Parcel",
          delivery_type: 48, item_type: "2",
        };
      } else if (provider === "redx") {
        payload = {
          customer_name: form.recipient_name,
          customer_phone: form.recipient_phone,
          delivery_area: form.area || form.thana || form.city,
          customer_address: form.address,
          merchant_invoice_id: form.merchant_invoice_id,
          cash_collection_amount: Number(form.cod_amount || 0),
          parcel_weight: Number(form.weight || 500), // grams
          instruction: form.note || "",
          pickup_store_id: form.store_id ? Number(form.store_id) : undefined,
        };
      } else if (provider === "steadfast") {
        payload = {
          invoice: form.merchant_invoice_id || `INV-${Date.now()}`,
          recipient_name: form.recipient_name,
          recipient_phone: form.recipient_phone,
          recipient_address: [form.address, form.thana, form.city, form.zip].filter(Boolean).join(", "),
          cod_amount: Number(form.cod_amount || 0),
          note: form.note || "",
        };
      } else if (provider === "paperfly") {
        payload = {
          merOrderRef: form.merchant_invoice_id || `ORD-${Date.now()}`,
          pickMerchantName: form.pickMerchantName || "Default",
          pickMerchantAddress: form.pickMerchantAddress || "",
          pickMerchantThana: form.pickMerchantThana || "",
          pickMerchantDistrict: form.pickMerchantDistrict || "",
          pickupMerchantPhone: form.pickupMerchantPhone || "",
          productSizeWeight: "standard",
          productBrief: form.productBrief || "Parcel",
          packagePrice: Number(form.packagePrice || form.cod_amount || 0),
          deliveryOption: "regular",
          custname: form.recipient_name,
          custaddress: form.address,
          customerThana: form.customerThana || form.thana || "",
          customerDistrict: form.customerDistrict || form.city || "",
          custPhone: form.recipient_phone,
          max_weight: form.max_weight || "1",
        };
      }
      const res = await fetch(`/api/logistics/labels/${provider}`, { method: "POST", body: JSON.stringify(payload) });
      const json = await res.json();
      setResult({ ok: res.ok, json });
    } catch (err) {
      setResult({ ok: false, error: String(err?.message || err) });
    } finally { setBusy(false); }
  }

  async function doTrack() {
    setTrack(null);
    const qp = new URLSearchParams();
    if (provider === "ecourier") qp.set("ecr", trackId);
    else if (provider === "pathao") qp.set("consignment_id", trackId);
    else if (provider === "redx") qp.set("tracking_id", trackId);
    else if (provider === "steadfast") qp.set("tracking_code", trackId);
    else if (provider === "paperfly") qp.set("tracking_number", trackId);
    const res = await fetch(`/api/logistics/track/${provider}?` + qp.toString());
    const json = await res.json();
    setTrack({ ok: res.ok, json });
  }

  const MetaPickers = () => {
    if (provider === "ecourier" || provider === "pathao") {
      return (
        <>
          <Field label="City">
            <select className="border rounded p-2 w-full" value={form.city || form.city_id} onChange={e => onCityChange(e.target.value)}>
              <option value="">Select city</option>
              {(cities?.message || cities?.data || cities || []).map((c, i) => (
                <option key={i} value={c.value || c.city_id || c.name}>{c.name || c.city_name || c.value}</option>
              ))}
            </select>
          </Field>
          <Field label={provider === "ecourier" ? "Thana" : "Zone"}>
            <select className="border rounded p-2 w-full" value={form.thana || form.zone_id} onChange={e => onZoneChange(e.target.value)}>
              <option value="">{provider === "ecourier" ? "Select thana" : "Select zone"}</option>
              {(zones?.message || zones?.data || zones || []).map((z, i) => (
                <option key={i} value={z.value || z.zone_id || z.name}>{z.name || z.zone_name || z.value}</option>
              ))}
            </select>
          </Field>
          <Field label="Area">
            <select className="border rounded p-2 w-full" value={form.area || form.area_id} onChange={e => setForm(s => ({ ...s, area: e.target.value, area_id: e.target.value }))}>
              <option value="">Select area</option>
              {(areas?.message || areas?.data || areas || []).map((a, i) => (
                <option key={i} value={(a.value || a.area_id || a.name).toString()}>{a.name || a.area_name || a.value}</option>
              ))}
            </select>
          </Field>
        </>
      );
    }
    return null;
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Logistics → Labels</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Field label="Courier provider">
          <select className="border rounded p-2 w-full" value={provider} onChange={e => setProvider(e.target.value)}>
            {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Merchant Invoice / Ref">
          <input className="border rounded p-2 w-full" value={form.merchant_invoice_id} onChange={e => setForm(s => ({ ...s, merchant_invoice_id: e.target.value }))}/>
        </Field>
        {(provider === "pathao" || provider === "redx") && (
          <Field label="Store ID (if any)">
            <input className="border rounded p-2 w-full" value={form.store_id} onChange={e => setForm(s => ({ ...s, store_id: e.target.value }))}/>
          </Field>
        )}
      </div>

      <form onSubmit={createLabel} className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Recipient name"><input className="border rounded p-2 w-full" value={form.recipient_name} onChange={e => setForm(s => ({ ...s, recipient_name: e.target.value }))} /></Field>
        <Field label="Recipient phone"><input className="border rounded p-2 w-full" value={form.recipient_phone} onChange={e => setForm(s => ({ ...s, recipient_phone: e.target.value }))} /></Field>
        <Field label="Address"><input className="border rounded p-2 w-full" value={form.address} onChange={e => setForm(s => ({ ...s, address: e.target.value }))} /></Field>

        <MetaPickers />

        {provider === "ecourier" && (
          <>
            <Field label="ZIP"><input className="border rounded p-2 w-full" value={form.zip} onChange={e => setForm(s => ({ ...s, zip: e.target.value }))} /></Field>
            <div />
          </>
        )}

        <Field label="COD amount (BDT)"><input type="number" className="border rounded p-2 w-full" value={form.cod_amount} onChange={e => setForm(s => ({ ...s, cod_amount: e.target.value }))} /></Field>
        <Field label="Items"><input type="number" className="border rounded p-2 w-full" value={form.items} onChange={e => setForm(s => ({ ...s, items: e.target.value }))} /></Field>
        <Field label="Weight (kg or g*)"><input className="border rounded p-2 w-full" value={form.weight} onChange={e => setForm(s => ({ ...s, weight: e.target.value }))} /></Field>
        <Field label="Note / Instruction"><input className="border rounded p-2 w-full" value={form.note} onChange={e => setForm(s => ({ ...s, note: e.target.value }))} /></Field>

        {provider === "paperfly" && (
          <>
            <Field label="Pickup merchant name"><input className="border rounded p-2 w-full" value={form.pickMerchantName} onChange={e=>setForm(s=>({...s,pickMerchantName:e.target.value}))}/></Field>
            <Field label="Pickup phone"><input className="border rounded p-2 w-full" value={form.pickupMerchantPhone} onChange={e=>setForm(s=>({...s,pickupMerchantPhone:e.target.value}))}/></Field>
            <Field label="Pickup address"><input className="border rounded p-2 w-full" value={form.pickMerchantAddress} onChange={e=>setForm(s=>({...s,pickMerchantAddress:e.target.value}))}/></Field>
            <Field label="Pickup thana"><input className="border rounded p-2 w-full" value={form.pickMerchantThana} onChange={e=>setForm(s=>({...s,pickMerchantThana:e.target.value}))}/></Field>
            <Field label="Pickup district"><input className="border rounded p-2 w-full" value={form.pickMerchantDistrict} onChange={e=>setForm(s=>({...s,pickMerchantDistrict:e.target.value}))}/></Field>
            <Field label="Product brief"><input className="border rounded p-2 w-full" value={form.productBrief} onChange={e=>setForm(s=>({...s,productBrief:e.target.value}))}/></Field>
            <Field label="Max weight (kg)"><input className="border rounded p-2 w-full" value={form.max_weight} onChange={e=>setForm(s=>({...s,max_weight:e.target.value}))}/></Field>
          </>
        )}

        <div className="col-span-1 md:col-span-2 flex items-center gap-3 mt-2">
          <button disabled={busy || submitDisabled} className="px-4 py-2 rounded bg-black text-white disabled:opacity-50">{busy ? "Creating..." : "Create label"}</button>
          <span className="text-sm text-gray-500">Provider: {provider}</span>
        </div>
      </form>

      {result && (
        <pre className={`mt-4 p-3 rounded ${result.ok ? "bg-green-50" : "bg-red-50"} text-xs overflow-auto`}>
{JSON.stringify(result, null, 2)}
        </pre>
      )}

      <div className="mt-8 border-t pt-6">
        <h2 className="text-lg font-semibold mb-2">Track</h2>
        <div className="flex gap-2">
          <input className="border rounded p-2 flex-1" placeholder="Tracking / Consignment / ECR" value={trackId} onChange={e=>setTrackId(e.target.value)} />
          <button onClick={doTrack} className="px-4 py-2 rounded bg-gray-800 text-white">Track</button>
        </div>
        {track && (
          <pre className={`mt-4 p-3 rounded ${track.ok ? "bg-blue-50" : "bg-red-50"} text-xs overflow-auto`}>
{JSON.stringify(track, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
