import React, { useState } from 'react';

export default function ReturnsForm({ userId }) {
  const [formData, setFormData] = useState({
    productId: '',
    orderId: '',
    reason: '',
    photo: null,
  });
  const [message, setMessage] = useState('');

  const handleChange = (e) => {
    const { name, value, files } = e.target;
    if (name === 'photo') {
      setFormData((prev) => ({ ...prev, photo: files[0] }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const data = new FormData();
      data.append('productId', formData.productId);
      data.append('orderId', formData.orderId);
      data.append('reason', formData.reason);
      if (formData.photo) data.append('photo', formData.photo);
      data.append('customerId', userId);

      const res = await fetch('/api/returns', {
        method: 'POST',
        body: data,
      });
      if (!res.ok) throw new Error('Submission failed');
      setMessage('Return request submitted successfully.');
      setFormData({ productId: '', orderId: '', reason: '', photo: null });
    } catch (error) {
      setMessage('Error submitting return request.');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="returns-form">
      <label>Product ID:
        <input type="text" name="productId" value={formData.productId} onChange={handleChange} required />
      </label>
      <label>Order ID:
        <input type="text" name="orderId" value={formData.orderId} onChange={handleChange} required />
      </label>
      <label>Reason:
        <textarea name="reason" value={formData.reason} onChange={handleChange} required />
      </label>
      <label>Photo (optional):
        <input type="file" name="photo" accept="image/*" onChange={handleChange} />
      </label>
      <button type="submit">Submit Return</button>
      {message && <p>{message}</p>}
    </form>
  );
}
