"""Bidirectional conversion between settings_json and visualization_state.

*settings_json* is the richer format stored inside a parquetbundle's 4th part.
It is keyed by annotation name and contains per-category color, shape, zOrder,
plus UI preferences (maxVisibleValues, sortMode, hiddenValues, etc.).

*visualization_state* is the flat format consumed by the Dash web app::

    {
        "annotation_colors": {"annotation_name": {"value": "rgba(...)"}},
        "marker_shapes":     {"annotation_name": {"value": "circle"}},
    }
"""

import re

NA_COLOR = "#C0C0C0"  # light gray for missing / <NA> values
NA_INTERNAL = "__NA__"  # frontend internal key for N/A categories
NA_PINNED_COLOR = "#DDDDDD"  # lighter gray used for N/A in pinned settings
# Every spelling a missing cell can arrive under. "None" is what ``str()`` yields
# for a parquet NULL, which is how the frontend writer now stores a missing
# categorical cell (it no longer writes the __NA__ sentinel), so without it a
# styled N/A group lands under the key "None" and the frontend's __NA__ lookup
# misses it.
_NA_LABELS = {"", "<NA>", "NaN", "__NA__", "None"}
REST_MARKER = "__REST__"  # auto-fill remaining slots from top values by frequency

# Kelly's 21 Colors of Maximum Contrast (same order as the web frontend)
KELLYS_COLORS = [
    "#F3C300",
    "#875692",
    "#F38400",
    "#A1CAF1",
    "#BE0032",
    "#C2B280",
    "#008856",
    "#E68FAC",
    "#0067A5",
    "#F99379",
    "#604E97",
    "#F6A600",
    "#B3446C",
    "#DCD300",
    "#882D17",
    "#8DB600",
    "#654522",
    "#E25822",
    "#2B3D26",
    "#F2F3F4",
    "#222222",
]


def _hex_to_rgba(hex_color: str, alpha: float = 0.8) -> str:
    """Convert ``#RRGGBB`` to ``rgba(R, G, B, alpha)``."""
    hex_color = hex_color.lstrip("#")
    r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
    return f"rgba({r}, {g}, {b}, {alpha})"


def _rgba_to_hex(rgba_str: str) -> str:
    """Convert ``rgba(R, G, B, A)`` to ``#RRGGBB``."""
    match = re.match(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)", rgba_str)
    if not match:
        return rgba_str  # return as-is if already hex or unrecognized
    r, g, b = int(match.group(1)), int(match.group(2)), int(match.group(3))
    return f"#{r:02X}{g:02X}{b:02X}"


LEGEND_SETTINGS_KEY = "legendSettings"


# Envelope siblings of "legendSettings" in the frontend shape. "exportOptions" is a
# required field of the frontend's BundleSettings, so a genuine envelope always
# carries at least one of these.
_ENVELOPE_SIBLING_KEYS = frozenset(
    {"exportOptions", "publishState", "eatOverlayEnabled", "eatConfidenceThreshold"}
)

# Keys of a single annotation's settings entry. Their presence at the top level of
# a ``legendSettings`` value means it is one annotation's entry, not a map of them.
_ANNOTATION_SETTINGS_KEYS = frozenset(
    {
        "categories",
        "sortMode",
        "maxVisibleValues",
        "hiddenValues",
        "includeShapes",
        "shapeSize",
        "selectedPaletteId",
        "numericSettings",
    }
)


def _is_frontend_envelope(settings: object) -> bool:
    """True only for the frontend's nested part-4 shape.

    Bare key presence is not a safe discriminator: annotation names come from
    user CSV headers, so a **flat** Python map can legitimately hold a column
    literally called ``legendSettings``. Unwrapping that would hand back one
    annotation's own entry as if it were the whole map and blank every legend.
    Requiring a sibling mirrors the frontend reader's own two-field check in
    ``settings-validation.ts`` (``isNormalizedBundleSettings``).

    A sibling alone is not enough either — the siblings are plausible column
    names too, so two colliding headers (``legendSettings`` + ``publishState``)
    would be misread as an envelope. The inner shape settles it: in a real
    envelope the value under ``legendSettings`` is keyed by annotation name, so
    it never carries per-annotation settings keys at its top level, whereas a
    colliding column's own entry is exactly such a settings dict.
    """
    if not isinstance(settings, dict):
        return False
    inner = settings.get(LEGEND_SETTINGS_KEY)
    return (
        isinstance(inner, dict)
        and bool(_ENVELOPE_SIBLING_KEYS & settings.keys())
        and not (_ANNOTATION_SETTINGS_KEYS & inner.keys())
    )


def unwrap_settings(settings: dict) -> dict:
    """Return the annotation-keyed settings map from either bundle-part-4 shape.

    Two writers produce the settings part and their shapes differ:

    * Python (:func:`visualization_state_to_settings`) writes the **flat** shape,
      keyed directly by annotation name.
    * The web frontend writes a **nested** envelope,
      ``{"legendSettings": {<annotation>: ...}, "exportOptions": ..., "publishState": ...,
      "eatOverlayEnabled": ..., "eatConfidenceThreshold": ...}``.

    The frontend reader (``normalizeBundleSettings``) already accepts both, so
    this is the Python-side half of that contract. Without it, iterating a
    frontend-written dict hits scalar envelope values (``eatOverlayEnabled`` is a
    bool) and every legend colour/shape is silently dropped.
    """
    return (
        settings[LEGEND_SETTINGS_KEY] if _is_frontend_envelope(settings) else settings
    )


def rewrap_settings(settings: dict, template: dict | None) -> dict:
    """Re-apply the envelope *template* was read in, so a rewrite stays non-lossy.

    ``protspace style`` reads part 4, rebuilds the annotation map, and writes it
    back. When the source bundle came from the frontend, writing the bare map
    would drop ``publishState``, ``exportOptions`` and the EAT display settings.

    *settings* is overlaid on the template's own annotation map rather than
    replacing it. Only annotations that survive
    :func:`settings_to_visualization_state` get rebuilt, and a numeric annotation
    never does — the frontend persists its categories with empty colors/shapes,
    which that function filters out — so replacing the map wholesale would drop
    every numeric annotation's ``numericSettings``, palette and hidden values.
    """
    if not _is_frontend_envelope(template):
        return settings
    return {
        **template,
        LEGEND_SETTINGS_KEY: {**template[LEGEND_SETTINGS_KEY], **settings},
    }


def settings_to_visualization_state(settings: dict) -> dict:
    """Convert *settings_json* to *visualization_state*.

    Args:
        settings: Settings in either bundle shape (see :func:`unwrap_settings`) —
            keyed by annotation name, each containing a ``categories`` mapping
            with ``color`` (hex) and ``shape`` entries.

    Returns:
        ``{"annotation_colors": {...}, "marker_shapes": {...}}``
    """
    annotation_colors: dict[str, dict[str, str]] = {}
    marker_shapes: dict[str, dict[str, str]] = {}

    for annotation_name, annotation_settings in unwrap_settings(settings).items():
        # Tolerate stray scalars so one malformed entry cannot blank the whole legend.
        if not isinstance(annotation_settings, dict):
            continue
        categories = annotation_settings.get("categories", {})
        if not categories:
            continue

        colors: dict[str, str] = {}
        shapes: dict[str, str] = {}

        for value, cat_info in categories.items():
            color = cat_info.get("color", "")
            if color:
                colors[value] = _hex_to_rgba(color) if color.startswith("#") else color
            shape = cat_info.get("shape", "")
            if shape:
                shapes[value] = shape

        if colors:
            annotation_colors[annotation_name] = colors
        if shapes:
            marker_shapes[annotation_name] = shapes

    return {
        "annotation_colors": annotation_colors,
        "marker_shapes": marker_shapes,
    }


def _sort_values_for_zorder(
    values: set[str],
    sort_mode: str,
    frequencies: dict[str, int] | None,
) -> list[str]:
    """Return *values* ordered according to *sort_mode*.

    NA-like values (:data:`_NA_LABELS`) are always placed last regardless of
    sort mode.

    Args:
        values: The set of category values.
        sort_mode: One of ``"size-desc"``, ``"size-asc"``, ``"alpha-asc"``,
            ``"alpha-desc"``, ``"manual"``.
        frequencies: Mapping ``{value: count}``.  Required for size-based
            modes; ignored for alphabetical / manual modes.
    """
    regular = sorted(v for v in values if v not in _NA_LABELS)
    na_present = sorted(v for v in values if v in _NA_LABELS)

    if sort_mode in ("size-desc", "size-asc") and frequencies:
        regular.sort(
            key=lambda v: frequencies.get(v, 0),
            reverse=(sort_mode == "size-desc"),
        )
    elif sort_mode == "alpha-desc":
        regular.sort(reverse=True)
    # else: alpha-asc (default alphabetical) or manual → keep alphabetical

    return regular + na_present


def visualization_state_to_settings(
    viz_state: dict,
    existing_settings: dict | None = None,
    value_frequencies: dict[str, dict[str, int]] | None = None,
    style_overrides: dict[str, dict] | None = None,
) -> dict:
    """Convert *visualization_state* back to *settings_json*.

    When *existing_settings* is provided, UI-only fields (maxVisibleValues,
    sortMode, hiddenValues, etc.) are preserved from it.  Otherwise sensible
    defaults are used.

    Args:
        viz_state: ``{"annotation_colors": {...}, "marker_shapes": {...}}``
        existing_settings: Optional prior settings to merge with, in either
            bundle shape. A frontend-written envelope is preserved on output so
            styling a frontend export keeps its publishState/EAT settings.
        value_frequencies: Optional ``{annotation_name: {value: count}}``
            used to assign zOrder when sortMode is size-based.
        style_overrides: Optional ``{annotation_name: {key: value}}`` with
            settings-level keys (``sortMode``, ``maxVisibleValues``, etc.)
            from the user's styles input.

    Returns:
        Settings in the same bundle shape *existing_settings* was given in —
        keyed by annotation name, or wrapped back into the frontend envelope.
    """
    annotation_colors = viz_state.get("annotation_colors", {})
    marker_shapes = viz_state.get("marker_shapes", {})
    existing = unwrap_settings(existing_settings) if existing_settings else None

    # Collect all annotation names referenced in colors, shapes, or style_overrides
    all_annotations = set(annotation_colors.keys()) | set(marker_shapes.keys())
    if style_overrides:
        all_annotations |= set(style_overrides.keys())

    settings: dict = {}
    for annotation_name in all_annotations:
        colors = annotation_colors.get(annotation_name, {})
        shapes = marker_shapes.get(annotation_name, {})

        # Start from existing settings if available
        if existing and annotation_name in existing:
            ann_settings = dict(existing[annotation_name])
            existing_categories = dict(ann_settings.get("categories", {}))
        else:
            ann_settings = {
                "includeShapes": bool(shapes),
                "shapeSize": 30,
                "sortMode": "size-desc",
                "hiddenValues": [],
                "enableDuplicateStackUI": False,
                "selectedPaletteId": "kellys",
            }
            existing_categories = {}

        # Apply style overrides from user input
        _SETTINGS_KEYS = {
            "sortMode",
            "maxVisibleValues",
            "shapeSize",
            "hiddenValues",
            "selectedPaletteId",
            "zOrderSort",
            "pinnedValues",
        }
        if style_overrides and annotation_name in style_overrides:
            for key, val in style_overrides[annotation_name].items():
                if key in _SETTINGS_KEYS:
                    ann_settings[key] = val

        # Pop processing-only keys (not stored in output settings).
        # "zOrderSort" overrides "sortMode" for zOrder computation only
        # (e.g. zOrderSort="size-desc" + sortMode="manual" → frequency-based
        # zOrders displayed in manual order by the frontend).
        # "pinnedValues" is an ordered list of category names that receive
        # zOrders 0..N-1; remaining values follow, sorted by zOrderSort/sortMode.
        zorder_sort = ann_settings.pop("zOrderSort", None)
        pinned_values: list[str] = ann_settings.pop("pinnedValues", None) or []
        sort_mode = zorder_sort or ann_settings.get("sortMode", "size-desc")
        freqs = value_frequencies.get(annotation_name) if value_frequencies else None

        # Build categories from colors, shapes, and (if needed) frequency data.
        # When style_overrides reference an annotation with no pre-existing
        # colors/shapes, fall back to value_frequencies for the value list.
        categories: dict = {}
        all_values = set(colors.keys()) | set(shapes.keys())
        if not all_values and freqs:
            all_values = set(freqs.keys())

        if pinned_values:
            # Resolve pinned values against all_values (with NA alias matching).
            # ONLY pinned values go into categories — this ensures the
            # frontend's _visibleValues matches exactly the pinned set.
            #
            # The special marker __REST__ is expanded to top values by frequency
            # to fill up to maxVisibleValues.  Example:
            #   pinnedValues: ["__REST__", ""]  →  top N-1 by freq, then NA
            max_vis = ann_settings.get("maxVisibleValues", 10)

            # First pass: collect explicit (non-REST) pinned values
            explicit_pinned: list[str] = []
            has_rest = False
            for pv in pinned_values:
                if pv == REST_MARKER:
                    has_rest = True
                elif pv in all_values:
                    explicit_pinned.append(pv)
                elif pv in _NA_LABELS:
                    for alias in _NA_LABELS:
                        if alias in all_values:
                            explicit_pinned.append(alias)
                            break

            if has_rest and freqs:
                # Auto-fill: pick top values by sort_mode, excluding already-pinned and NA
                candidates = _sort_values_for_zorder(
                    all_values - _NA_LABELS - set(explicit_pinned),
                    sort_mode,
                    freqs,
                )
                # explicit_pinned already includes resolved NA entries,
                # so subtracting its length accounts for all non-REST slots.
                rest_slots = max_vis - len(explicit_pinned)
                rest_values = candidates[: max(0, rest_slots)]

                # Second pass: build ordered list, replacing __REST__ with auto-fill
                valid_pinned: list[str] = []
                for pv in pinned_values:
                    if pv == REST_MARKER:
                        valid_pinned.extend(rest_values)
                    elif pv in all_values:
                        valid_pinned.append(pv)
                    elif pv in _NA_LABELS:
                        for alias in _NA_LABELS:
                            if alias in all_values:
                                valid_pinned.append(alias)
                                break
            else:
                valid_pinned = explicit_pinned

            ordered_values = valid_pinned
        else:
            ordered_values = _sort_values_for_zorder(all_values, sort_mode, freqs)

        color_slot = 0
        for i, value in enumerate(ordered_values):
            cat = dict(existing_categories.get(value, {}))
            cat["zOrder"] = i

            color = colors.get(value, cat.get("color", ""))
            if color:
                cat["color"] = _rgba_to_hex(color) if "rgba" in str(color) else color
            elif pinned_values:
                # Auto-assign Kelly's palette colors for pinned values
                if value in _NA_LABELS:
                    cat["color"] = NA_PINNED_COLOR
                else:
                    cat["color"] = KELLYS_COLORS[color_slot % len(KELLYS_COLORS)]
                    color_slot += 1

            shape = shapes.get(value, cat.get("shape", "circle"))
            cat["shape"] = shape

            # Use __NA__ as the key for NA values (frontend internal format)
            key = NA_INTERNAL if value in _NA_LABELS else value
            categories[key] = cat

        if not pinned_values:
            # Ensure <NA> / empty values always get light gray
            for na_label in ("", "<NA>", "NaN"):
                if na_label in categories:
                    categories[na_label].setdefault("color", NA_COLOR)

        ann_settings["categories"] = categories
        # Set maxVisibleValues to actual category count
        ann_settings.setdefault("maxVisibleValues", 10)
        if shapes:
            ann_settings["includeShapes"] = True

        settings[annotation_name] = ann_settings

    return rewrap_settings(settings, existing_settings)
