import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ArchivedCompanyReadonlyDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyName?: string | null;
};

export function ArchivedCompanyReadonlyDialog({
  open,
  onOpenChange,
  companyName,
}: ArchivedCompanyReadonlyDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Archived Company Is Read-Only</DialogTitle>
          <DialogDescription>
            {companyName
              ? `"${companyName}" is archived. To make changes, first unarchive it from Company Settings.`
              : "This company is archived. To make changes, first unarchive it from Company Settings."}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Tip: Before deleting, take an export backup package.
        </div>
        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="outline" asChild>
            <Link to="/company/export" onClick={() => onOpenChange(false)}>
              Export backup
            </Link>
          </Button>
          <Button asChild>
            <Link to="/company/settings" onClick={() => onOpenChange(false)}>
              Open settings
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
