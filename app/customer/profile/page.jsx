// app/customer/profile/page.jsx
'use client';

import { useState } from 'react';
import { useUpdateMe } from '@/src/hooks/use_update_me';

export default function ProfilePage() {
  const { updateMe, loading, error, data } = useUpdateMe();
  const [form, setForm] = useState({
    name: '',
    phone_number: '',
    date_of_birth: '',
    gender: '',
  });

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((s) => ({ ...s, [name]: value }));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    await updateMe(form);
  };

  return (
    <main
      className="
        mt-[2in]
        bg-gradient-to-b from-slate-50 to-white
      "
    >
      {/* Page container with generous side margins */}
      <div className="mx-auto w-full max-w-7xl px-6 sm:px-8 lg:px-16 pb-24">
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-slate-900">
            Your Profile
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Keep your details up to date. Phone is used as your primary identity.
          </p>
        </div>

        {/* Content row: keeps air on both sides on large screens */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Spacer/Side info column (adds premium breathing room on desktop) */}
          <aside className="hidden lg:block lg:col-span-3" />

          {/* Form card */}
          <div
            className="
              lg:col-span-6
              rounded-3xl border border-slate-200 bg-white/90 backdrop-blur
              p-6 md:p-10
            "
          >
            <form onSubmit={onSubmit} className="grid grid-cols-1 gap-6">
              {/* Name */}
              <div className="grid gap-2">
                <label htmlFor="name" className="text-sm font-medium text-slate-700">
                  Your name
                </label>
                <input
                  id="name"
                  name="name"
                  value={form.name}
                  onChange={onChange}
                  placeholder="Full name"
                  autoComplete="name"
                  className="
                    w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none
                    focus:border-slate-400 focus:ring-2 focus:ring-slate-300/60 transition
                  "
                />
              </div>

              {/* Phone */}
              <div className="grid gap-2">
                <label htmlFor="phone_number" className="text-sm font-medium text-slate-700">
                  Phone number
                </label>
                <input
                  id="phone_number"
                  name="phone_number"
                  value={form.phone_number}
                  onChange={onChange}
                  placeholder="+8801XXXXXXXXX or 01XXXXXXXXX"
                  inputMode="tel"
                  autoComplete="tel"
                  className="
                    w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none
                    focus:border-slate-400 focus:ring-2 focus:ring-slate-300/60 transition
                  "
                />
                <p className="text-xs text-slate-500">
                  We’ll normalize to +880 and keep it unique to your account.
                </p>
              </div>

              {/* Two-up row */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="grid gap-2">
                  <label htmlFor="date_of_birth" className="text-sm font-medium text-slate-700">
                    Date of birth
                  </label>
                  <input
                    id="date_of_birth"
                    type="date"
                    name="date_of_birth"
                    value={form.date_of_birth}
                    onChange={onChange}
                    className="
                      w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none
                      focus:border-slate-400 focus:ring-2 focus:ring-slate-300/60 transition
                    "
                  />
                </div>

                <div className="grid gap-2">
                  <label htmlFor="gender" className="text-sm font-medium text-slate-700">
                    Gender
                  </label>
                  <select
                    id="gender"
                    name="gender"
                    value={form.gender}
                    onChange={onChange}
                    className="
                      w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none
                      focus:border-slate-400 focus:ring-2 focus:ring-slate-300/60 transition
                    "
                  >
                    <option value="">Select…</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>

              {/* Submit */}
              <div className="pt-2">
                <button
                  disabled={loading}
                  type="submit"
                  className="
                    w-full rounded-xl px-5 py-3 font-semibold tracking-wide
                    bg-[#0B1F3A] text-white hover:bg-[#112A4F] active:scale-[.99]
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B1F3A]/40
                    disabled:opacity-60 transition
                  "
                >
                  {loading ? 'Saving…' : 'Save changes'}
                </button>
              </div>

              {/* Messages */}
              {error && (
                <p className="text-sm text-rose-600" role="alert" aria-live="polite">
                  {String(error)}
                </p>
              )}
              {data?.ok && (
                <p className="text-sm text-emerald-600" role="status" aria-live="polite">
                  Profile updated successfully.
                </p>
              )}
            </form>
          </div>

          {/* Spacer/Side info column */}
          <aside className="hidden lg:block lg:col-span-3" />
        </section>
      </div>
    </main>
  );
}
