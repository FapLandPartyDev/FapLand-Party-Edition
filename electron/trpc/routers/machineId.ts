import { publicProcedure, router } from "../trpc";
import { getMachineId } from "../../services/machineId";

export const machineIdRouter = router({
    getMachineId: publicProcedure.query(async () => {
        return await getMachineId();
    }),
});
