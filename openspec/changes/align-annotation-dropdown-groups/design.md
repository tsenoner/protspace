## Context

8e5d0df7 changed the dropdown from "a Predicted group first" to "group by source, badge predictions per row". The reason: predicted annotations come from several sources (Biocentral, InterPro's de-novo predictors, unknown `predicted_` columns), and the source is what tells the reader where a value comes from. The predicted flag is orthogonal, so it became a per-row mark and stopped being a section.

## Decisions

- **Spec follows the code.** The behaviour shipped, the tests pin it, and the friendly-labels requirement already relies on the per-row predicted badge to tell apart two annotations that share a label. Reverting the code to match the old spec would undo a deliberate change.
- **Replace the requirement rather than modify it.** The old requirement's name ("Dedicated 'Predicted' group …") would be false under any edit, so it is removed and a correctly named requirement is added.
