# description/too-short

**Category:** description · **Default severity:** warning

Fires when a tool has a description, but it's under 20 characters or fewer than 4 words.

## Why it matters

A description like `"Gets data."` technically exists, satisfying `description/missing`, but tells the model
nothing about when to prefer this tool over a similar one, what the parameters mean, or what it returns. The 20
character / 4 word floor is deliberately low — it catches only the clearly-too-thin cases, not merely "could be
more detailed."

## Example

```json
{ "name": "get_status", "description": "Gets data." }
```

Fix: `"description": "Gets the current processing status and queue position for a submitted job, given its job id."`

## How to fix

Expand the description to cover what the tool does and when to use it — aim for at least one full sentence with
real information, ideally the 3-4 sentences Anthropic's tool-use guidance recommends for anything non-trivial.

## Configuring

Override severity with `"severities": {"description/too-short": "off"}`, or ignore one tool with `"ignore":
["description/too-short:<toolName>"]`.
