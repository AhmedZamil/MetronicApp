import { handleSubmissions } from "../js/server/handlers.js";
import { fromNodeRequest } from "../js/server/node-request.js";

export default function handler(req, res) {
  const result = handleSubmissions(fromNodeRequest(req));
  res.status(result.status).json(result.body);
}
