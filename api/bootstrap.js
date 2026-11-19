import { handleBootstrap } from "../js/server/handlers.js";

export default function handler(_req, res) {
  const result = handleBootstrap();
  res.status(result.status).json(result.body);
}
