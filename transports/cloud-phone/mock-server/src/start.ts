import { buildMock } from "./server.js";
const port = Number(process.env.MOCK_PORT ?? "4100");
buildMock().listen({ port }).then(() => console.log(`mock upstream on :${port}`));
