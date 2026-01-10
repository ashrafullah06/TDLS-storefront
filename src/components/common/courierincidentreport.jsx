// src/components/common/courierincidentreport.jsx
import React, { useState } from "react";

export default function CourierIncidentReport() {
  const [formData, setFormData] = useState({
    courierId: "",
    incidentType: "",
    description: "",
  });
  const [message, setMessage] = useState("");

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/courier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error("Submission failed");
      setMessage("Incident report submitted successfully.");
      setFormData({ courierId: "", incidentType: "", description: "" });
    } catch (error) {
      setMessage("Error submitting report.");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="courier-incident-report-form">
      <label>
        Courier ID:
        <input
          name="courierId"
          value={formData.courierId}
          onChange={handleChange}
          required
        />
      </label>
      <label>
        Incident Type:
        <input
          name="incidentType"
          value={formData.incidentType}
          onChange={handleChange}
          required
        />
      </label>
      <label>
        Description:
        <textarea
          name="description"
          value={formData.description}
          onChange={handleChange}
          required
        />
      </label>
      <button type="submit">Submit Incident Report</button>
      {message && <p>{message}</p>}
    </form>
  );
}
