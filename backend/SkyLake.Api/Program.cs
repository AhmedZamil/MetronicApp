using System.Text.Json.Nodes;
using SkyLake.Api;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();
var seedPath = Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, "..", "..", "data", "seed.json"));
var store = new Store(Path.Combine(app.Environment.ContentRootPath, "App_Data", "store.json"), seedPath);

app.MapGet("/api/bootstrap", () => Results.Json(store.Bootstrap()));
app.MapGet("/api/forms", (HttpRequest request) =>
{
    var (tenant, role) = Headers(request);
    var result = store.GetForms(tenant, role, request.Query["key"]);
    return Results.Json(result.Body, statusCode: result.Status);
});
app.MapPut("/api/forms", async (HttpRequest request) =>
{
    var (tenant, role) = Headers(request);
    var body = await ReadBody(request);
    if (body?["__invalidJson"] is not null) return Results.Json(new JsonObject { ["title"] = "Request body must be JSON.", ["status"] = 400 }, statusCode: 400);
    var schema = body?["schema"]?.AsObject() ?? body;
    var result = store.PutForm(tenant, role, request.Query["key"], schema);
    return Results.Json(result.Body, statusCode: result.Status);
});
app.MapGet("/api/submissions", (HttpRequest request) =>
{
    var (tenant, role) = Headers(request);
    var result = store.GetSubmissions(tenant, role);
    return Results.Json(result.Body, statusCode: result.Status);
});
app.MapPost("/api/submissions", async (HttpRequest request) =>
{
    var (tenant, role) = Headers(request);
    var body = await ReadBody(request);
    if (body?["__invalidJson"] is not null) return Results.Json(new JsonObject { ["title"] = "Request body must be JSON.", ["status"] = 400 }, statusCode: 400);
    var result = store.PostSubmission(tenant, role, request.Headers["X-User-Name"], body);
    return Results.Json(result.Body, statusCode: result.Status);
});

app.Run();

static (string? Tenant, string? Role) Headers(HttpRequest request)
{
    return (request.Headers["X-Tenant-Id"], request.Headers["X-Role"]);
}

static async Task<JsonObject?> ReadBody(HttpRequest request)
{
    if (request.ContentLength == 0) return new JsonObject();
    using var reader = new StreamReader(request.Body);
    var raw = await reader.ReadToEndAsync();
    if (string.IsNullOrWhiteSpace(raw)) return new JsonObject();
    try
    {
        return JsonNode.Parse(raw)?.AsObject();
    }
    catch (System.Text.Json.JsonException)
    {
        return new JsonObject { ["__invalidJson"] = true };
    }
}
