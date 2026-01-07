// app/forgot-password/page.jsx
import ForgotPasswordForm from "@/components/auth/forgot_password_form.jsx";

export default function ForgotPasswordPage() {
  return (
    <main
      className="min-h-screen flex items-center justify-center px-4 md:px-8 bg-transparent"
      style={{ paddingTop: "192px", paddingBottom: "288px" }}
    >
      <div className="w-full max-w-[960px]">
        <ForgotPasswordForm />
      </div>
    </main>
  );
}
