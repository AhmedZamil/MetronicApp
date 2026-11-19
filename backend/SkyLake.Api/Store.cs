using System.Text.Json.Nodes;

namespace SkyLake.Api;

public sealed class Store
{
    private readonly string _storePath;
    private readonly JsonObject _seed;
    private readonly Lock _gate = new();

    public Store(string storePath, string seedPath)
    {
        _storePath = storePath;
        _seed = JsonNode.Parse(File.ReadAllText(seedPath))!.AsObject();
        Directory.CreateDirectory(Path.GetDirectoryName(storePath)!);
        if (!File.Exists(storePath)) Save(Empty());
    }

    public JsonObject Bootstrap()
    {
        var users = new JsonArray();
        foreach (var user in _seed["users"]!.AsArray().OfType<JsonObject>())
        {
            users.Add(new JsonObject
            {
                ["id"] = Text(user["id"]),
                ["name"] = Text(user["name"]),
                ["role"] = Text(user["role"]),
                ["tenantId"] = Text(user["tenantId"])
            });
        }
        return new JsonObject
        {
            ["product"] = "SkyLake Control Forms",
            ["company"] = "SKY LAKE SOLUTIONS",
            ["tenants"] = _seed["tenants"]!.DeepClone(),
            ["users"] = users
        };
    }

    public (int Status, JsonObject Body) GetForms(string? tenantId, string? role, string? key)
    {
        var auth = Auth(tenantId, role);
        if (auth.Error is not null) return auth.Error.Value;
        if (!string.IsNullOrEmpty(key))
        {
            var form = FindForm(key);
            if (form is null || FormEngine.FormsForTenant(new JsonArray(form.DeepClone()), auth.TenantId).Count == 0)
                return Problem(404, "Form not found.");
            return (200, new JsonObject { ["form"] = StoredOrSeed(key) });
        }
        var forms = new JsonArray();
        foreach (var form in FormEngine.FormsForTenant(_seed["forms"]!.AsArray(), auth.TenantId))
            forms.Add(StoredOrSeed(Text(form["key"])));
        return (200, new JsonObject { ["forms"] = forms });
    }

    public (int Status, JsonObject Body) PutForm(string? tenantId, string? role, string? key, JsonObject? incoming)
    {
        var auth = Auth(tenantId, role);
        if (auth.Error is not null) return auth.Error.Value;
        if (incoming is null) return Problem(400, "Schema is required.");
        var existing = FindForm(key ?? Text(incoming["key"]));
        if (existing is null) return Problem(404, "Form not found.");
        if (!FormEngine.CanEditSchema(auth.Role, existing)) return Problem(403, "You cannot edit this form.");
        var schema = incoming.DeepClone().AsObject();
        schema["key"] = Text(existing["key"]);
        schema["scope"] = Text(existing["scope"]);
        var shape = FormEngine.ValidateSchemaShape(schema);
        if (shape.Count > 0) return Problem(400, "Schema is invalid", new JsonObject { ["schema"] = new JsonArray(shape.Select(item => (JsonNode)JsonValue.Create(item)!).ToArray()) });
        lock (_gate)
        {
            var store = Load();
            var schemas = store["schemas"]!.AsObject();
            schemas[Text(existing["key"])] = schema.DeepClone();
            Save(store);
        }
        return (200, new JsonObject { ["ok"] = true, ["schema"] = schema });
    }

    public (int Status, JsonObject Body) GetSubmissions(string? tenantId, string? role)
    {
        var auth = Auth(tenantId, role);
        if (auth.Error is not null) return auth.Error.Value;
        var rows = new JsonArray();
        foreach (var row in FormEngine.SubmissionsForTenant(_seed["submissions"]!.AsArray(), auth.TenantId)) rows.Add(row.DeepClone());
        lock (_gate)
        {
            foreach (var row in FormEngine.SubmissionsForTenant(Load()["submissions"]!.AsArray(), auth.TenantId)) rows.Add(row.DeepClone());
        }
        return (200, new JsonObject { ["submissions"] = rows });
    }

    public (int Status, JsonObject Body) PostSubmission(string? tenantId, string? role, string? userName, JsonObject? body)
    {
        var auth = Auth(tenantId, role);
        if (auth.Error is not null) return auth.Error.Value;
        var formKey = Text(body?["formKey"]);
        var existing = FindForm(formKey);
        if (existing is null) return Problem(404, "Form not found.");
        var schema = StoredOrSeed(formKey).AsObject();
        var values = body?["values"] as JsonObject ?? new JsonObject();
        var errors = FormEngine.Validate(schema, values);
        if (errors.Count > 0) return Problem(400, "Validation failed", errors);
        var submission = new JsonObject
        {
            ["id"] = $"sub_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString("x")}",
            ["formKey"] = Text(existing["key"]),
            ["formTitle"] = Text(schema["title"]),
            ["tenantId"] = auth.TenantId,
            ["submittedBy"] = string.IsNullOrWhiteSpace(userName) ? "User" : userName,
            ["submittedAt"] = DateTimeOffset.UtcNow.ToString("O"),
            ["values"] = FormEngine.ToPayload(schema, values)
        };
        lock (_gate)
        {
            var store = Load();
            store["submissions"]!.AsArray().Add(submission.DeepClone());
            Save(store);
        }
        return (200, new JsonObject { ["submission"] = submission });
    }

    private JsonNode StoredOrSeed(string key)
    {
        lock (_gate)
        {
            var stored = Load()["schemas"]!.AsObject()[key];
            if (stored is not null) return stored.DeepClone();
        }
        return FindForm(key)!.DeepClone();
    }

    private JsonObject? FindForm(string? key)
    {
        return _seed["forms"]!.AsArray().OfType<JsonObject>().FirstOrDefault(item => Text(item["key"]) == key);
    }

    private (string TenantId, string Role, (int Status, JsonObject Body)? Error) Auth(string? tenantId, string? role)
    {
        if (string.IsNullOrWhiteSpace(tenantId) || string.IsNullOrWhiteSpace(role))
            return ("", "", Problem(400, "Tenant and role are required."));
        if (role is not ("analyst" or "tenant-admin" or "platform-admin"))
            return ("", "", Problem(403, "Unknown role."));
        if (!_seed["tenants"]!.AsArray().OfType<JsonObject>().Any(item => Text(item["id"]) == tenantId))
            return ("", "", Problem(400, "Unknown tenant."));
        return (tenantId, role, null);
    }

    private JsonObject Load()
    {
        return JsonNode.Parse(File.ReadAllText(_storePath))!.AsObject();
    }

    private void Save(JsonObject store)
    {
        File.WriteAllText(_storePath, store.ToJsonString());
    }

    private static JsonObject Empty() => new() { ["schemas"] = new JsonObject(), ["submissions"] = new JsonArray() };

    private static (int Status, JsonObject Body) Problem(int status, string title, JsonObject? errors = null)
    {
        var body = new JsonObject { ["title"] = title, ["status"] = status };
        if (errors is not null) body["errors"] = errors;
        return (status, body);
    }

    private static string Text(JsonNode? node) => node is null ? "" : node.GetValue<string>();
}
