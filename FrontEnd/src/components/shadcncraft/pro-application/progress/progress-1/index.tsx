import {
  ProgressItem,
  ProgressItemContent,
  ProgressItemDescription,
  ProgressItemHeader,
  ProgressItemIndicator,
  ProgressItemSeparator,
  ProgressItemTitle,
} from "@/components/shadcncraft/pro-application/progress-item-1";

export function Progress1() {
  return (
    <div className="flex gap-1">
      <ProgressItem>
        <ProgressItemHeader>
          <ProgressItemIndicator>1</ProgressItemIndicator>
          <ProgressItemSeparator />
        </ProgressItemHeader>

        <ProgressItemContent>
          <ProgressItemTitle>Account Setup</ProgressItemTitle>
          <ProgressItemDescription>
            Create your profile and set up basic information to get started.
          </ProgressItemDescription>
        </ProgressItemContent>
      </ProgressItem>

      <ProgressItem>
        <ProgressItemHeader>
          <ProgressItemIndicator>2</ProgressItemIndicator>
          <ProgressItemSeparator />
        </ProgressItemHeader>

        <ProgressItemContent>
          <ProgressItemTitle>Verify Identity</ProgressItemTitle>
          <ProgressItemDescription>
            Upload a valid ID and complete verification.
          </ProgressItemDescription>
        </ProgressItemContent>
      </ProgressItem>

      <ProgressItem>
        <ProgressItemHeader>
          <ProgressItemIndicator>3</ProgressItemIndicator>
          <ProgressItemSeparator />
        </ProgressItemHeader>

        <ProgressItemContent>
          <ProgressItemTitle>Choose Plan</ProgressItemTitle>
          <ProgressItemDescription>
            Select the subscription plan that best fits your needs and budget.
          </ProgressItemDescription>
        </ProgressItemContent>
      </ProgressItem>

      <ProgressItem>
        <ProgressItemHeader>
          <ProgressItemIndicator>4</ProgressItemIndicator>
          <ProgressItemSeparator />
        </ProgressItemHeader>

        <ProgressItemContent>
          <ProgressItemTitle>Start Using</ProgressItemTitle>
          <ProgressItemDescription>
            Begin exploring features and customize your experience.
          </ProgressItemDescription>
        </ProgressItemContent>
      </ProgressItem>
    </div>
  );
}
