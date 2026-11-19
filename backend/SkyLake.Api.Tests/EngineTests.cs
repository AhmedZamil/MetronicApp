using System.Text.Json.Nodes;
using SkyLake.Api;
using Xunit;

namespace SkyLake.Api.Tests;

public class EngineTests
{
    [Fact]
    public void SharedCasesMatchTheJavaScriptEngine()
    {
        var root = FindRepoRoot();
        var seed = JsonNode.Parse(File.ReadAllText(Path.Combine(root, "data", "seed.json")))!.AsObject();
        var cases = JsonNode.Parse(File.ReadAllText(Path.Combine(root, "tests", "cases.json")))!.AsArray();
        var failures = new List<string>();
        foreach (var node in cases)
        {
            var entry = node!.AsObject();
            var name = entry["name"]!.GetValue<string>();
            try
            {
                Run(seed, entry);
            }
            catch (Exception error)
            {
                failures.Add($"{name}: {error.Message}");
            }
        }
        Assert.True(failures.Count == 0, string.Join(Environment.NewLine, failures));
    }

    private static void Run(JsonObject seed, JsonObject entry)
    {
        var fn = entry["fn"]?.GetValue<string>() ?? "rules";
        if (fn == "access")
        {
            Assert.Equal(entry["expect"]!.GetValue<bool>(), FormEngine.CanEditSchema(entry["role"]!.GetValue<string>(), Form(seed, entry["schema"]!.GetValue<string>())));
            return;
        }
        if (fn == "filter")
        {
            if (entry["kind"]!.GetValue<string>() == "submissions")
            {
                var ids = FormEngine.SubmissionsForTenant(seed["submissions"]!.AsArray(), entry["tenantId"]!.GetValue<string>()).Select(item => item["id"]!.GetValue<string>());
                Assert.Equal(Strings(entry["expectIds"]!.AsArray()), ids);
            }
            else
            {
                var keys = FormEngine.FormsForTenant(seed["forms"]!.AsArray(), entry["tenantId"]!.GetValue<string>()).Select(item => item["key"]!.GetValue<string>());
                Assert.Equal(Strings(entry["expectKeys"]!.AsArray()), keys);
            }
            return;
        }
        if (fn == "shape")
        {
            var errors = FormEngine.ValidateSchemaShape(SchemaFor(seed, entry));
            Assert.Equal(entry["expectValid"]!.GetValue<bool>(), errors.Count == 0);
            if (entry["expectErrorIncludes"] is JsonValue includes)
                Assert.Contains(errors, item => item.Contains(includes.GetValue<string>(), StringComparison.Ordinal));
            return;
        }
        if (fn == "remove")
        {
            var schema = Form(seed, entry["schema"]!.GetValue<string>());
            var result = FormEngine.RemoveField(schema, entry["field"]!.GetValue<string>());
            Assert.Equal(entry["expectOk"]!.GetValue<bool>(), result.Ok);
            if (!result.Ok) Assert.NotEmpty(result.Refs);
            if (result.Ok) Assert.Empty(FormEngine.ValidateSchemaShape(schema));
            return;
        }
        if (fn == "add")
        {
            var schema = Form(seed, entry["schema"]!.GetValue<string>());
            var result = FormEngine.AddField(schema, entry["spec"]!.AsObject());
            Assert.Equal(entry["expectOk"]!.GetValue<bool>(), result.Ok);
            if (result.Ok) Assert.Empty(FormEngine.ValidateSchemaShape(schema));
            return;
        }
        if (fn == "seedValid")
        {
            var submission = seed["submissions"]!.AsArray().OfType<JsonObject>().First(item => item["id"]!.GetValue<string>() == entry["id"]!.GetValue<string>());
            var schema = Form(seed, submission["formKey"]!.GetValue<string>());
            Assert.Empty(FormEngine.Validate(schema, submission["values"]!.AsObject()));
            return;
        }
        var form = SchemaFor(seed, entry);
        var values = entry["values"] as JsonObject ?? new JsonObject();
        if (fn == "prepared")
        {
            var prepared = FormEngine.SyncValues(form, values);
            foreach (var pair in entry["expect"]!["prepared"]!.AsObject())
                Assert.True(JsonNode.DeepEquals(prepared[pair.Key], pair.Value), pair.Key);
            return;
        }
        if (fn == "options")
        {
            var synced = FormEngine.SyncValues(form, values);
            var options = FormEngine.ResolveOptions(form["fields"]![entry["field"]!.GetValue<string>()]!.AsObject(), synced, form["fields"]!.AsObject())
                .Select(option => option!["value"]!.GetValue<string>());
            Assert.Equal(Strings(entry["expect"]!["optionValues"]!.AsArray()), options);
            return;
        }
        if (entry["expect"]?["visible"] is JsonObject visible)
        {
            var fields = form["fields"]!.AsObject();
            foreach (var pair in visible)
                Assert.Equal(pair.Value!.GetValue<bool>(), FormEngine.IsVisible(fields[pair.Key] as JsonObject, values, fields));
        }
        if (entry["expect"]?["errors"] is not null || entry["expect"]?["errorKeys"] is not null)
        {
            IReadOnlyCollection<string>? only = null;
            if (entry["only"] is JsonArray onlyIds) only = Strings(onlyIds).ToArray();
            else if (entry["step"] is JsonValue step) only = FormEngine.FieldIdsInStep(form, step.GetValue<string>());
            var errors = FormEngine.Validate(form, values, only);
            if (entry["expect"]?["errors"] is JsonObject expected) Assert.True(JsonNode.DeepEquals(expected, errors), errors.ToJsonString());
            if (entry["expect"]?["errorKeys"] is JsonArray keys)
                Assert.Equal(Strings(keys).OrderBy(item => item), errors.Select(pair => pair.Key).OrderBy(item => item));
        }
        if (entry["expect"]?["payloadOmits"] is JsonArray omits)
        {
            var payload = FormEngine.ToPayload(form, values);
            foreach (var key in Strings(omits)) Assert.False(payload.ContainsKey(key), key);
        }
    }

    private static JsonObject SchemaFor(JsonObject seed, JsonObject entry)
    {
        if (entry["schemaInline"] is JsonObject inline) return inline.DeepClone().AsObject();
        var schema = Form(seed, entry["schema"]!.GetValue<string>());
        if (entry["mutateSpan"] is JsonValue target)
        {
            var name = target.GetValue<string>();
            foreach (var step in schema["steps"]!.AsArray().OfType<JsonObject>())
            foreach (var section in step["sections"]!.AsArray().OfType<JsonObject>())
            foreach (var row in section["rows"]!.AsArray().OfType<JsonObject>())
            foreach (var col in row["cols"]!.AsArray().OfType<JsonObject>())
            {
                if (col["field"]!.GetValue<string>() == name) col["span"] = 5;
            }
        }
        return schema;
    }

    private static JsonObject Form(JsonObject seed, string key)
    {
        return seed["forms"]!.AsArray().OfType<JsonObject>().First(item => item["key"]!.GetValue<string>() == key).DeepClone().AsObject();
    }

    private static IEnumerable<string> Strings(JsonArray array) => array.Select(item => item!.GetValue<string>());

    private static string FindRepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "data", "seed.json")) && File.Exists(Path.Combine(dir.FullName, "tests", "cases.json")))
                return dir.FullName;
            dir = dir.Parent;
        }
        throw new DirectoryNotFoundException("Could not find the repository root.");
    }
}
