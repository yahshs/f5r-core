import { Link } from "react-router-dom";
import ChangePasswordDialog from "@/components/auth/ChangePasswordDialog";
export default function Unavailable() {
  return (
    <main className="mx-auto max-w-xl space-y-5 p-8">
      <h1 className="text-2xl font-semibold">
        Customer accounts are unavailable
      </h1>
      <p>
        Purchases, billing and support tickets are not connected in this
        application. Existing customer accounts cannot create orders or payments
        here. Contact your seller through the verified purchase channel.
      </p>
      <ChangePasswordDialog />
      <Link className="block underline" to="/">
        Return home
      </Link>
    </main>
  );
}
