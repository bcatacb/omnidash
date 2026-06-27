import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { PowerAction } from "@duoplus/shared";
import { listPhones, batchPower } from "../../api/cloudPhone";

export function phonesKey(params: { page: number; pageSize: number }) {
  return ["phones", params.page, params.pageSize] as const;
}

export function usePhones(params: { page: number; pageSize: number }) {
  return useQuery({
    queryKey: phonesKey(params),
    queryFn: () => listPhones(params),
    refetchInterval: 8000,
  });
}

export function useBatchPower(params: { page: number; pageSize: number }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, action }: { ids: string[]; action: PowerAction }) => batchPower(ids, action),
    onSettled: () => qc.invalidateQueries({ queryKey: phonesKey(params) }),
  });
}
