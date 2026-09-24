const FAQS = [
  {
    question: "What is CattleCoin?",
    answer:
      "CattleCoin is a marketplace that connects two kinds of cattle producers - ranchers and feedlots - with investors who want to put money behind real cattle. A producer lists a real herd, decides how much of its value to open to outside investors, and investors buy tokens for that open portion.",
  },
  {
    question: "What does a token mean here?",
    answer:
      "A token represents a small slice of the portion of a herd's value that its producer has chosen to open to investors. Instead of one investor funding an entire herd, that open portion is split into smaller pieces so more people can take part.",
  },
  {
    question: "What's the difference between a rancher and a feedlot on here?",
    answer:
      "Ranchers are cow-calf producers - they raise and sell calves. Feedlots buy cattle (often from a rancher) and finish them before sale. Both are \"producers\" on the platform, and either one can list a herd it owns and open it to investors.",
  },
  {
    question: "Does a rancher need a feedlot to raise investor money?",
    answer:
      "No. A rancher can open their own herd to investors directly - it doesn't have to be picked up by a feedlot first. If a feedlot does buy the herd for finishing, that's a real sale with its own payout to the rancher's investors, and it opens a separate, new opportunity for feedlot-stage investors.",
  },
  {
    question: "What do investors fund?",
    answer:
      "Investors fund whatever portion of a herd's value the producer - rancher or feedlot - has chosen to open to the marketplace. Investors are never expected to cover a full herd by themselves.",
  },
  {
    question: "What can investors see before investing?",
    answer:
      "Investors can review herd information, pricing, health-related records, cost history, and other marketplace data the platform surfaces for each opportunity, including whether the herd carries LRP price-floor insurance.",
  },
  {
    question: "Does buying a token mean I physically own a cow?",
    answer:
      "No. A token represents fractional exposure to a cattle lot's value, not a claim to a specific animal or the ability to take possession of one.",
  },
  {
    question: "Why use tokens instead of buying a whole herd?",
    answer:
      "Whole herds require a lot of capital. Tokens split the open portion into smaller pieces so more people can participate with a smaller amount of money.",
  },
  {
    question: "How does a herd move from pasture to sale?",
    answer:
      "Each herd moves through stages - Ranch, Backgrounding, Feedlot, Processing, and Distribution. A herd can only move into Processing or Distribution once a real sale exists for it (pending or approved), so the stage always reflects an actual event, not just a status update.",
  },
  {
    question: "How do I know which dashboard to use?",
    answer:
      "Use the dashboard that matches your account role. Investors browse the marketplace and manage their holdings and money. Ranchers and feedlots each manage their own herds, costs, and sales. Admins manage platform-wide settings. Every role also has a My Account page for updating contact info and password.",
  },
];

export function FAQPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          FAQ
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">
          Frequently Asked Questions
        </h1>
        <p className="mt-4 text-base leading-7 text-muted-foreground">
          This page explains the main ideas behind the platform, including who
          uses it, how a herd gets opened to investors, and what investors are
          actually funding.
        </p>
      </div>

      <div className="grid gap-4">
        {FAQS.map((faq) => (
          <section key={faq.question} className="rounded-2xl border bg-card p-6">
            <h2 className="text-lg font-semibold">{faq.question}</h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              {faq.answer}
            </p>
          </section>
        ))}
      </div>
    </div>
  );
}

export default FAQPage;
