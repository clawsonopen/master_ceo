import { useCallback, useState } from "react";
import { useCompany } from "../context/CompanyContext";

export function useArchivedCompanyMutationGuard() {
  const { selectedCompany } = useCompany();
  const [dialogOpen, setDialogOpen] = useState(false);
  const isArchivedCompany = selectedCompany?.status === "archived";

  const guardMutation = useCallback(
    (action: () => void) => {
      if (isArchivedCompany) {
        setDialogOpen(true);
        return;
      }
      action();
    },
    [isArchivedCompany],
  );

  return {
    isArchivedCompany,
    dialogOpen,
    setDialogOpen,
    guardMutation,
    companyName: selectedCompany?.name ?? null,
  };
}
