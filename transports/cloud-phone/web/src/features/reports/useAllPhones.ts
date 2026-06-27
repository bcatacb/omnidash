import { useQuery } from "@tanstack/react-query";
import { listAllPhones } from "../../api/cloudPhone";

export function useAllPhones() {
  return useQuery({
    queryKey: ["phones-all"],
    queryFn: listAllPhones,
    staleTime: 30_000,
  });
}
