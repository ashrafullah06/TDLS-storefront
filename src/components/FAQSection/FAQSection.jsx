import React, { useState, useEffect } from 'react';
export default function FAQSection() {
  const [faqs, setFaqs] = useState([]);
  useEffect(() => {
    fetch('/api/faq-items')
      .then(res => res.json())
      .then(data => setFaqs(data));
  }, []);
  return (
    <div className="faq-section">
      <h2>Frequently Asked Questions</h2>
      {faqs.map((item, index) => (
        <details key={index}><summary>{item.question}</summary><p>{item.answer}</p></details>
      ))}
    </div>
  );
}