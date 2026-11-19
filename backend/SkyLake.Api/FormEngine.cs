using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace SkyLake.Api;

public static class FormEngine
{
    private static readonly HashSet<string> Types = ["text", "textarea", "number", "select", "radio", "checkbox", "date", "email", "repeater"];
    private static readonly HashSet<string> Scalar = ["text", "textarea", "number", "select", "radio", "checkbox", "date", "email"];
    private static readonly HashSet<int> Spans = [4, 6, 8, 12];
    private static readonly HashSet<string> Ops = ["eq", "neq", "in", "empty", "notEmpty"];
    private static readonly string[] Preserve = ["minLength", "maxLength", "pattern", "min", "max"];
    private static readonly Regex FieldId = new("^[a-z][a-zA-Z0-9]{0,40}$", RegexOptions.Compiled);
    private static readonly Regex KeyId = new("^[a-z][a-z0-9-]{0,60}$", RegexOptions.Compiled);
    private static readonly Regex Email = new("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", RegexOptions.Compiled);

    public static bool IsVisible(JsonObject? field, JsonObject values, JsonObject fields)
    {
        if (field is null) return false;
        return field["visibleWhen"] is not JsonObject rule || EvalRule(rule, values, fields);
    }

    public static bool IsRequired(JsonObject field, JsonObject values, JsonObject fields)
    {
        if (!IsVisible(field, values, fields)) return false;
        if (Bool(field["required"])) return true;
        return field["requiredWhen"] is JsonObject rule && EvalRule(rule, values, fields);
    }

    public static JsonObject SyncValues(JsonObject schema, JsonObject? values)
    {
        var next = values?.DeepClone().AsObject() ?? new JsonObject();
        var fields = Obj(schema["fields"]);
        for (var pass = 0; pass < 2; pass++)
        {
            foreach (var pair in fields)
            {
                var field = pair.Value as JsonObject ?? new JsonObject();
                var type = Str(field["type"]);
                if (type == "repeater")
                {
                    var copy = new JsonArray();
                    if (next[pair.Key] is JsonArray rows)
                    {
                        foreach (var row in rows)
                        {
                            if (row is JsonObject item) copy.Add(item.DeepClone());
                        }
                    }
                    next[pair.Key] = copy;
                    continue;
                }
                if (type == "checkbox") next[pair.Key] = JsonValue.Create(Bool(next[pair.Key]));
                else if (next[pair.Key] is null) next[pair.Key] = JsonValue.Create("");
                if (field["optionsFrom"] is JsonObject && IsVisible(field, next, fields))
                {
                    var allowed = new HashSet<string>(ResolveOptions(field, next, fields).Select(option => Str(option?["value"])));
                    var current = Str(next[pair.Key]);
                    if (current != "" && !allowed.Contains(current)) next[pair.Key] = JsonValue.Create("");
                }
            }
        }
        return next;
    }

    public static JsonArray ResolveOptions(JsonObject field, JsonObject values, JsonObject fields)
    {
        if (field["optionsFrom"] is JsonObject link)
        {
            var parent = ReadValue(Str(link["field"]), values, fields);
            var key = parent is JsonArray ? "" : AsString(parent);
            if (link["map"] is JsonObject map && map[key] is JsonArray options) return options;
            return new JsonArray();
        }
        return field["options"] as JsonArray ?? new JsonArray();
    }

    public static JsonObject Validate(JsonObject schema, JsonObject values, IReadOnlyCollection<string>? onlyIds = null)
    {
        var prepared = SyncValues(schema, values);
        var errors = new JsonObject();
        var fields = Obj(schema["fields"]);
        foreach (var pair in fields)
        {
            if (onlyIds is not null && !onlyIds.Contains(pair.Key)) continue;
            if (pair.Value is not JsonObject field || !IsVisible(field, prepared, fields)) continue;
            ValidateField(pair.Key, field, prepared[pair.Key], prepared, fields, errors);
        }
        return errors;
    }

    public static JsonObject ToPayload(JsonObject schema, JsonObject values)
    {
        var prepared = SyncValues(schema, values);
        var payload = new JsonObject();
        var fields = Obj(schema["fields"]);
        foreach (var pair in fields)
        {
            if (pair.Value is not JsonObject field || !IsVisible(field, prepared, fields)) continue;
            if (Str(field["type"]) == "repeater")
            {
                var rows = new JsonArray();
                if (prepared[pair.Key] is JsonArray source)
                {
                    var itemFields = Obj(field["itemFields"]);
                    foreach (var rowNode in source)
                    {
                        var row = rowNode as JsonObject ?? new JsonObject();
                        var item = new JsonObject();
                        foreach (var child in itemFields)
                        {
                            if (child.Value is not JsonObject childField || !IsVisible(childField, row, itemFields)) continue;
                            item[child.Key] = row[child.Key]?.DeepClone() ?? JsonValue.Create("");
                        }
                        rows.Add(item);
                    }
                }
                payload[pair.Key] = rows;
                continue;
            }
            payload[pair.Key] = prepared[pair.Key]?.DeepClone() ?? (Str(field["type"]) == "checkbox" ? JsonValue.Create(false) : JsonValue.Create(""));
        }
        return payload;
    }

    public static List<string> FieldIdsInStep(JsonObject schema, string stepId)
    {
        var ids = new List<string>();
        if (schema["steps"] is not JsonArray steps) return ids;
        foreach (var stepNode in steps)
        {
            if (stepNode is not JsonObject step || Str(step["id"]) != stepId) continue;
            if (step["sections"] is not JsonArray sections) return ids;
            foreach (var sectionNode in sections)
            {
                if (sectionNode is not JsonObject section || section["rows"] is not JsonArray rows) continue;
                foreach (var rowNode in rows)
                {
                    if (rowNode is not JsonObject row || row["cols"] is not JsonArray cols) continue;
                    foreach (var colNode in cols)
                    {
                        if (colNode is JsonObject col) ids.Add(Str(col["field"]));
                    }
                }
            }
        }
        return ids;
    }

    public static bool CanEditSchema(string role, JsonObject schema)
    {
        if (role == "platform-admin") return true;
        return role == "tenant-admin" && Str(schema["scope"]) != "global";
    }

    public static List<JsonObject> FormsForTenant(JsonArray forms, string tenantId)
    {
        var list = new List<JsonObject>();
        foreach (var node in forms)
        {
            if (node is not JsonObject form) continue;
            if (Str(form["scope"]) == "global") { list.Add(form); continue; }
            if (form["tenants"] is not JsonArray tenants || tenants.Count == 0) { list.Add(form); continue; }
            if (tenants.Any(item => Str(item) == tenantId)) list.Add(form);
        }
        return list;
    }

    public static List<JsonObject> SubmissionsForTenant(JsonArray items, string tenantId)
    {
        return items.OfType<JsonObject>().Where(item => Str(item["tenantId"]) == tenantId).ToList();
    }

    public static List<string> ValidateSchemaShape(JsonObject schema)
    {
        var errors = new List<string>();
        if (!KeyId.IsMatch(Str(schema["key"]))) errors.Add("Form key is invalid.");
        if (string.IsNullOrWhiteSpace(Str(schema["title"]))) errors.Add("Form title is required.");
        var scope = Str(schema["scope"]);
        if (scope != "tenant" && scope != "global") errors.Add("Scope must be tenant or global.");
        if (schema["version"] is JsonValue version)
        {
            var versionNumber = WholeNumber(version);
            if (versionNumber is null || versionNumber < 1) errors.Add("Version is invalid.");
        }
        if (schema["fields"] is not JsonObject fields) errors.Add("Fields are required.");
        else
        {
            foreach (var pair in fields)
            {
                if (!FieldId.IsMatch(pair.Key)) errors.Add($"Field id {pair.Key} is invalid.");
                if (pair.Value is not JsonObject field)
                {
                    errors.Add($"Field {pair.Key} is invalid.");
                    continue;
                }
                var type = Str(field["type"]);
                if (!Types.Contains(type)) errors.Add($"Field {pair.Key} has an unsupported type.");
                if (string.IsNullOrWhiteSpace(Str(field["label"]))) errors.Add($"Field {pair.Key} needs a label.");
                if (type == "repeater")
                {
                    if (field["itemFields"] is not JsonObject itemFields) errors.Add($"Field {pair.Key} needs item fields.");
                    else
                    {
                        foreach (var child in itemFields)
                        {
                            var name = $"{pair.Key}.{child.Key}";
                            if (!FieldId.IsMatch(child.Key)) errors.Add($"Field {name} is invalid.");
                            if (child.Value is not JsonObject childField || !Scalar.Contains(Str(childField["type"]))) errors.Add($"Field {name} must be a scalar.");
                            CheckChoice(child.Value as JsonObject, name, errors);
                            CheckRules(schema, child.Value as JsonObject, name, errors);
                        }
                    }
                }
                else
                {
                    CheckChoice(field, pair.Key, errors);
                    CheckRules(schema, field, pair.Key, errors);
                }
            }
        }
        if (schema["steps"] is not JsonArray steps || steps.Count == 0) errors.Add("At least one step is required.");
        var seen = new HashSet<string>();
        if (schema["steps"] is JsonArray layout)
        {
            foreach (var stepNode in layout)
            {
                if (stepNode is not JsonObject step) continue;
                if (!KeyId.IsMatch(Str(step["id"]))) errors.Add("Step id is invalid.");
                if (string.IsNullOrWhiteSpace(Str(step["title"]))) errors.Add("Step title is required.");
                if (step["sections"] is not JsonArray sections) continue;
                foreach (var sectionNode in sections)
                {
                    if (sectionNode is not JsonObject section || section["rows"] is not JsonArray rows) continue;
                    foreach (var rowNode in rows)
                    {
                        if (rowNode is not JsonObject row || row["cols"] is not JsonArray cols) continue;
                        foreach (var colNode in cols)
                        {
                            if (colNode is not JsonObject col) continue;
                            var field = Str(col["field"]);
                            if (col["span"] is not JsonValue spanValue || WholeNumber(spanValue) is not int span || !Spans.Contains(span))
                                errors.Add($"Column span for {field} must be 4, 6, 8, or 12.");
                            if (schema["fields"] is JsonObject known && known[field] is null) errors.Add($"Layout references unknown field {field}.");
                            if (!seen.Add(field)) errors.Add($"Field {field} is placed more than once.");
                        }
                    }
                }
            }
        }
        if (schema["fields"] is JsonObject placed)
        {
            foreach (var pair in placed)
            {
                if (!seen.Contains(pair.Key)) errors.Add($"Field {pair.Key} is missing from the layout.");
            }
        }
        return errors;
    }

    public static (bool Ok, List<string> Refs, List<string> Errors) RemoveField(JsonObject schema, string id)
    {
        var refs = FindReferences(schema, id);
        if (schema["fields"] is not JsonObject fields || fields[id] is null) return (false, refs, ["Field not found."]);
        if (refs.Count > 0) return (false, refs, [$"{id} is used by {string.Join(", ", refs)}."]);
        fields.Remove(id);
        if (schema["steps"] is JsonArray steps)
        {
            foreach (var stepNode in steps)
            {
                if (stepNode is not JsonObject step || step["sections"] is not JsonArray sections) continue;
                foreach (var sectionNode in sections)
                {
                    if (sectionNode is not JsonObject section || section["rows"] is not JsonArray rows) continue;
                    var kept = new JsonArray();
                    foreach (var rowNode in rows)
                    {
                        if (rowNode is not JsonObject row || row["cols"] is not JsonArray cols) continue;
                        var nextCols = new JsonArray();
                        foreach (var colNode in cols)
                        {
                            if (colNode is JsonObject col && Str(col["field"]) != id) nextCols.Add(col.DeepClone());
                        }
                        if (nextCols.Count > 0)
                        {
                            var copy = row.DeepClone().AsObject();
                            copy["cols"] = nextCols;
                            kept.Add(copy);
                        }
                    }
                    section["rows"] = kept;
                }
            }
        }
        return (true, [], []);
    }

    public static (bool Ok, List<string> Errors) AddField(JsonObject schema, JsonObject spec)
    {
        var errors = new List<string>();
        var id = Str(spec["id"]);
        if (!FieldId.IsMatch(id)) errors.Add("Field id is invalid.");
        if (schema["fields"] is JsonObject fields && fields[id] is not null) errors.Add("Field id already exists.");
        var type = Str(spec["type"]);
        if (!Scalar.Contains(type)) errors.Add("New fields must be scalar.");
        var span = spec["span"] is JsonValue spanValue && spanValue.TryGetValue<int>(out var parsed) ? parsed : 6;
        if (!Spans.Contains(span)) errors.Add("Span must be 4, 6, 8, or 12.");
        JsonObject? step = null;
        if (schema["steps"] is JsonArray steps)
        {
            step = steps.OfType<JsonObject>().FirstOrDefault(item => Str(item["id"]) == Str(spec["step"])) ?? steps.OfType<JsonObject>().FirstOrDefault();
        }
        if (step is null) errors.Add("Choose a step.");
        if (string.IsNullOrWhiteSpace(Str(spec["label"]))) errors.Add("Label is required.");
        if (errors.Count > 0 || schema["fields"] is not JsonObject target || step is null) return (false, errors);
        var field = new JsonObject
        {
            ["type"] = type,
            ["label"] = Str(spec["label"]).Trim(),
            ["required"] = Bool(spec["required"])
        };
        if (spec["visibleWhen"] is JsonObject visible) field["visibleWhen"] = visible.DeepClone();
        if (spec["requiredWhen"] is JsonObject required) field["requiredWhen"] = required.DeepClone();
        if (type is "select" or "radio")
        {
            field["options"] = spec["options"] is JsonArray options && options.Count > 0
                ? options.DeepClone()
                : new JsonArray(new JsonObject { ["value"] = "yes", ["label"] = "Yes" });
        }
        target[id] = field;
        if (step["sections"] is not JsonArray sections || sections.Count == 0)
        {
            step["sections"] = new JsonArray(new JsonObject
            {
                ["id"] = "main",
                ["title"] = "Fields",
                ["rows"] = new JsonArray()
            });
            sections = (JsonArray)step["sections"]!;
        }
        var first = (JsonObject)sections[0]!;
        if (first["rows"] is not JsonArray rows) first["rows"] = rows = new JsonArray();
        rows.Add(new JsonObject { ["cols"] = new JsonArray(new JsonObject { ["span"] = span, ["field"] = id }) });
        return (true, []);
    }

    private static void ValidateField(string path, JsonObject field, JsonNode? value, JsonObject values, JsonObject fields, JsonObject errors)
    {
        if (Str(field["type"]) == "repeater")
        {
            var rows = value as JsonArray ?? new JsonArray();
            var min = Int(field["minItems"]);
            if (rows.Count < min) errors[path] = Messages($"Add at least {min} item(s).");
            var itemFields = Obj(field["itemFields"]);
            for (var index = 0; index < rows.Count; index++)
            {
                var row = rows[index] as JsonObject ?? new JsonObject();
                foreach (var child in itemFields)
                {
                    if (child.Value is not JsonObject childField || !IsVisible(childField, row, itemFields)) continue;
                    ValidateScalar($"{path}[{index}].{child.Key}", childField, row[child.Key], row, itemFields, errors);
                }
            }
            return;
        }
        ValidateScalar(path, field, value, values, fields, errors);
    }

    private static void ValidateScalar(string path, JsonObject field, JsonNode? value, JsonObject values, JsonObject fields, JsonObject errors)
    {
        var type = Str(field["type"]);
        if (IsRequired(field, values, fields) && IsBlank(value, type))
        {
            errors[path] = Messages("This field is required.");
            return;
        }
        if (IsBlank(value, type)) return;
        var text = AsString(value);
        if ((type is "text" or "textarea") && field["minLength"] is not null && text.Trim().Length < Int(field["minLength"]))
        {
            errors[path] = Messages($"Enter at least {Int(field["minLength"])} characters.");
            return;
        }
        if ((type is "text" or "textarea" or "email") && field["maxLength"] is not null && text.Length > Int(field["maxLength"]))
        {
            errors[path] = Messages($"Enter at most {Int(field["maxLength"])} characters.");
            return;
        }
        if (type == "email" && !Email.IsMatch(text))
        {
            errors[path] = Messages("Enter a valid email address.");
            return;
        }
        if (field["pattern"] is JsonValue patternValue && patternValue.TryGetValue<string>(out var pattern))
        {
            try
            {
                if (!Regex.IsMatch(text, pattern)) errors[path] = Messages("Enter a value in the expected format.");
            }
            catch (ArgumentException)
            {
                errors[path] = Messages("Enter a value in the expected format.");
            }
            if (errors[path] is not null) return;
        }
        if (type == "number")
        {
            if (!double.TryParse(text, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var number))
            {
                errors[path] = Messages("Enter a number.");
                return;
            }
            if (field["min"] is not null && number < Double(field["min"]))
            {
                errors[path] = Messages($"Enter a number of at least {NumberText(field["min"])}.");
                return;
            }
            if (field["max"] is not null && number > Double(field["max"]))
            {
                errors[path] = Messages($"Enter a number no greater than {NumberText(field["max"])}.");
                return;
            }
        }
        if (type is "select" or "radio")
        {
            var allowed = new HashSet<string>(ResolveOptions(field, values, fields).Select(option => Str(option?["value"])));
            if (!allowed.Contains(text)) errors[path] = Messages("Choose a valid option.");
        }
    }

    private static bool EvalRule(JsonObject rule, JsonObject values, JsonObject fields)
    {
        if (rule["all"] is JsonArray all) return all.All(item => item is JsonObject child && EvalRule(child, values, fields));
        if (rule["any"] is JsonArray any) return any.Any(item => item is JsonObject child && EvalRule(child, values, fields));
        return Compare(Str(rule["op"]), ReadValue(Str(rule["field"]), values, fields), rule["value"]);
    }

    private static bool Compare(string op, JsonNode? actual, JsonNode? expected)
    {
        if (actual is JsonArray list)
        {
            var items = list.Select(AsString).ToList();
            return op switch
            {
                "eq" => items.Contains(AsString(expected)),
                "neq" => items.All(item => item != AsString(expected)),
                "in" => expected is JsonArray values && items.Any(item => values.Select(AsString).Contains(item)),
                "empty" => items.Count == 0,
                "notEmpty" => items.Count > 0,
                _ => false
            };
        }
        var text = actual is null ? null : AsString(actual);
        return op switch
        {
            "eq" => JsonNode.DeepEquals(actual, expected),
            "neq" => !JsonNode.DeepEquals(actual, expected),
            "in" => expected is JsonArray values && values.Any(item => JsonNode.DeepEquals(item, actual)),
            "empty" => actual is null || text == "",
            "notEmpty" => actual is not null && text != "",
            _ => false
        };
    }

    private static JsonNode? ReadValue(string path, JsonObject values, JsonObject fields)
    {
        if (string.IsNullOrEmpty(path)) return null;
        var parts = path.Split('.');
        if (parts.Length == 2 && fields[parts[0]] is JsonObject field && Str(field["type"]) == "repeater")
        {
            var result = new JsonArray();
            if (values[parts[0]] is JsonArray rows)
            {
                foreach (var rowNode in rows)
                {
                    if (rowNode is not JsonObject row) continue;
                    var cell = row[parts[1]];
                    if (cell is null) continue;
                    if (cell is JsonValue value && value.TryGetValue<string>(out var text) && text == "") continue;
                    result.Add(cell.DeepClone());
                }
            }
            return result;
        }
        return values[path]?.DeepClone();
    }

    private static List<string> FindReferences(JsonObject schema, string id)
    {
        var refs = new List<string>();
        foreach (var pair in Obj(schema["fields"]))
        {
            if (pair.Key == id || pair.Value is not JsonObject field) continue;
            var paths = RulePaths(field);
            if (Str(field["type"]) == "repeater")
            {
                foreach (var child in Obj(field["itemFields"]))
                {
                    if (child.Value is JsonObject childField) paths.AddRange(RulePaths(childField));
                }
            }
            if (paths.Any(path => path == id || path.StartsWith(id + ".", StringComparison.Ordinal))) refs.Add(pair.Key);
        }
        return refs;
    }

    private static List<string> RulePaths(JsonObject field)
    {
        var paths = new List<string>();
        Collect(field["visibleWhen"] as JsonObject, paths);
        Collect(field["requiredWhen"] as JsonObject, paths);
        if (field["optionsFrom"] is JsonObject link && Str(link["field"]) != "") paths.Add(Str(link["field"]));
        return paths;
    }

    private static void Collect(JsonObject? rule, List<string> paths)
    {
        if (rule is null) return;
        if (rule["all"] is JsonArray all)
        {
            foreach (var item in all) Collect(item as JsonObject, paths);
        }
        if (Str(rule["field"]) != "") paths.Add(Str(rule["field"]));
    }

    private static void CheckChoice(JsonObject? field, string id, List<string> errors)
    {
        if (field is null) return;
        var type = Str(field["type"]);
        if (type is not ("select" or "radio")) return;
        if (field["optionsFrom"] is JsonObject link)
        {
            if (Str(link["field"]) == "" || link["map"] is not JsonObject) errors.Add($"Field {id} optionsFrom is incomplete.");
        }
        else if (field["options"] is not JsonArray options || options.Count == 0) errors.Add($"Field {id} needs options.");
        if (field["options"] is JsonArray listed)
        {
            foreach (var option in listed)
            {
                if (option is not JsonObject item || item["value"] is null || item["label"] is not JsonValue) errors.Add($"Field {id} has a bad option.");
            }
        }
    }

    private static void CheckRules(JsonObject schema, JsonObject? field, string id, List<string> errors)
    {
        if (field is null) return;
        foreach (var key in new[] { "visibleWhen", "requiredWhen" })
        {
            if (field[key] is JsonObject rule && !RuleOk(schema, rule)) errors.Add($"Field {id} has an invalid {key} rule.");
        }
        if (field["optionsFrom"] is JsonObject link && !PathExists(schema, Str(link["field"]))) errors.Add($"Field {id} depends on an unknown field.");
    }

    private static bool RuleOk(JsonObject schema, JsonObject rule)
    {
        if (rule["all"] is JsonArray all) return all.Count > 0 && all.All(item => item is JsonObject child && RuleOk(schema, child));
        if (!Ops.Contains(Str(rule["op"])) || !PathExists(schema, Str(rule["field"]))) return false;
        return Str(rule["op"]) != "in" || rule["value"] is JsonArray;
    }

    private static bool PathExists(JsonObject schema, string path)
    {
        if (path == "") return false;
        var parts = path.Split('.');
        var fields = Obj(schema["fields"]);
        if (parts.Length == 2) return fields[parts[0]] is JsonObject field && Str(field["type"]) == "repeater" && Obj(field["itemFields"])[parts[1]] is not null;
        return parts.Length == 1 && fields[path] is not null;
    }

    private static bool IsBlank(JsonNode? value, string type)
    {
        if (type == "checkbox") return !Bool(value);
        if (value is JsonArray array) return array.Count == 0;
        if (value is null) return true;
        return string.IsNullOrWhiteSpace(AsString(value));
    }

    private static JsonArray Messages(string message) => new(JsonValue.Create(message));

    private static JsonObject Obj(JsonNode? node) => node as JsonObject ?? new JsonObject();

    private static string Str(JsonNode? node) => node switch
    {
        JsonValue value when value.TryGetValue<string>(out var text) => text,
        null => "",
        _ => node.ToJsonString().Trim('"')
    };

    private static string AsString(JsonNode? node) => Str(node);

    private static bool Bool(JsonNode? node) => node is JsonValue value && value.TryGetValue<bool>(out var flag) && flag;

    private static int? WholeNumber(JsonValue value)
    {
        if (value.TryGetValue<int>(out var whole)) return whole;
        if (value.TryGetValue<double>(out var number) && Math.Abs(number - Math.Round(number)) < 0.0001) return (int)Math.Round(number);
        return null;
    }

    private static int Int(JsonNode? node)
    {
        if (node is JsonValue value && value.TryGetValue<int>(out var number)) return number;
        return int.TryParse(Str(node), out var parsed) ? parsed : 0;
    }

    private static double Double(JsonNode? node)
    {
        if (node is JsonValue value && value.TryGetValue<double>(out var number)) return number;
        if (node is JsonValue intValue && intValue.TryGetValue<int>(out var whole)) return whole;
        return double.TryParse(Str(node), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var parsed) ? parsed : 0;
    }

    private static string NumberText(JsonNode? node)
    {
        if (node is JsonValue value && value.TryGetValue<int>(out var whole)) return whole.ToString(System.Globalization.CultureInfo.InvariantCulture);
        return Double(node).ToString(System.Globalization.CultureInfo.InvariantCulture);
    }
}
