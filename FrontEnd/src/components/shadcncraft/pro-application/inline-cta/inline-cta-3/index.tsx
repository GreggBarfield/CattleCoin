import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mail, Check } from "lucide-react";

export function InlineCTA3() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // TODO: wire to a real pilot-request API endpoint once one exists.
    // For now this just confirms receipt locally; no email is sent anywhere.
    setSubmitted(true);
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-5 overflow-hidden rounded-xl bg-card p-5 text-left shadow-lg">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold">Join the pilot list</h3>
        <p className="text-sm text-muted-foreground">
          Leave your email and we'll reach out when the pilot opens.
        </p>
      </div>

      {submitted ? (
        <p className="flex items-center gap-2 text-sm font-medium text-primary">
          <Check className="h-4 w-4" /> Thanks — we'll be in touch.
        </p>
      ) : (
        <form className="flex flex-col gap-2 md:flex-row" onSubmit={handleSubmit}>
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@example.com"
            className="w-full md:max-w-xs"
          />
          <Button type="submit" className="w-full gap-2 md:w-fit" aria-label="Request pilot access">
            <Mail className="h-4 w-4" /> Request Access
          </Button>
        </form>
      )}
    </div>
  );
}
