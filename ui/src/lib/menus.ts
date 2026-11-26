/**
 * Context menu contents. To add a menu entry, add an item to one of these
 * functions and point `action` at a function in actions.ts.
 */
import * as act from './actions';
import {live} from './live.svelte';
import {selection} from './selection.svelte';
import type {ShapeKind} from './shared';
import {ui} from './ui.svelte';
import {view} from './view.svelte';

export type MenuItem =
    | {
          label: string;
          action?: () => void;
          /** Shown on the right, e.g. "⌘D". Display only: shortcuts live in shortcuts.ts. */
          shortcut?: string;
          disabled?: boolean;
          danger?: boolean;
          /** Shows a check mark. */
          checked?: boolean;
          children?: MenuItem[];
      }
    | {separator: true}
    | {heading: string};

const sep = {separator: true} as const;
const mod = act.modKey;

/** Right-click on a fixture. Acts on the whole selection (which includes the clicked fixture). */
export function fixtureMenu(clickedId: string): MenuItem[] {
    const ids = selection.list;
    const fixtures = selection.fixtures;
    const clicked = live.fixture(clickedId);
    const n = ids.length;
    const many = n > 1;
    const readonly = live.readonly;
    const hasLinear = fixtures.some((f) => f.shape === 'bar' || f.shape === 'strip');
    const allRdm = fixtures.every((f) => f.rdm !== false);

    const items: MenuItem[] = [{heading: many ? `${n} fixtures` : (clicked?.name ?? 'Fixture')}];
    if (!readonly) {
        items.push(
            {label: many ? 'Edit selection' : 'Edit', action: () => ui.show('fixture')},
            {label: 'Duplicate', shortcut: `${mod}D`, action: () => act.duplicateSelection()},
            {label: 'Readdress…', action: () => act.openReaddress(ids)},
            sep,
            {
                label: 'Align',
                disabled: !many,
                children: [
                    {label: 'Left edges', action: () => act.alignSelection('left')},
                    {label: 'Horizontal centres', action: () => act.alignSelection('hcenter')},
                    {label: 'Right edges', action: () => act.alignSelection('right')},
                    sep,
                    {label: 'Top edges', action: () => act.alignSelection('top')},
                    {label: 'Vertical centres', action: () => act.alignSelection('vcenter')},
                    {label: 'Bottom edges', action: () => act.alignSelection('bottom')},
                ],
            },
            {
                label: 'Distribute',
                disabled: n < 3,
                children: [
                    {label: 'Horizontally', action: () => act.distributeSelection('x')},
                    {label: 'Vertically', action: () => act.distributeSelection('y')},
                ],
            },
            {label: 'Arrange in rows', disabled: !many, action: () => act.arrange(ids)},
        );
        items.push({
            label: 'Size',
            children: [50, 75, 100, 125, 150, 200, 300].map((pct) => ({
                label: `${pct}%`,
                checked: fixtures.every((f) => Math.round((f.scale ?? 1) * 100) === pct),
                action: () => act.resize(pct / 100, ids),
            })),
        });
        if (hasLinear) {
            items.push({
                label: 'Rotate',
                children: [0, 45, 90, 135, 180, 270].map((deg) => ({
                    label: `${deg}°`,
                    checked: fixtures.every((f) => (f.rotation ?? 0) === deg),
                    action: () => act.rotate(deg, ids),
                })),
            });
        }
    }
    items.push(
        sep,
        {
            label: 'Select',
            children: [
                {label: 'Same type', action: () => act.selectWhere((f) => f.type === clicked?.type)},
                {label: 'Same universe', action: () => act.selectWhere((f) => f.universe === clicked?.universe)},
                {label: 'All', shortcut: `${mod}A`, action: () => selection.selectAll()},
                {label: 'None', shortcut: 'Esc', action: () => selection.clear()},
            ],
        },
        {label: 'Show in universe view', action: () => act.showInUniverse(clickedId)},
    );
    if (!readonly) {
        items.push(
            {label: 'Answer RDM', checked: allRdm, action: () => act.setRdm(!allRdm, ids)},
            sep,
            {label: deleteLabel(), shortcut: '⌫', danger: true, action: () => act.deleteSelection()},
        );
    }
    return items;
}

const ROTATIONS = [0, 45, 90, 135, 180, 225, 270, 315];

const SHAPE_ITEMS: Array<{kind: ShapeKind; label: string}> = [
    {kind: 'stage', label: 'Stage'},
    {kind: 'truss', label: 'Truss'},
    {kind: 'roof', label: 'Roof'},
    {kind: 'area', label: 'Area (audience, FOH…)'},
    {kind: 'label', label: 'Text label'},
];

/** "Add shape" submenu; `at` is where the shape's centre goes (default: middle of the view). */
export function addShapeItems(at?: {x: number; y: number}): MenuItem[] {
    return SHAPE_ITEMS.map(({kind, label}) => ({label, action: () => act.addShape(kind, at)}));
}

function deleteLabel(): string {
    const n = selection.size + selection.shapeCount;
    if (n <= 1) return 'Delete';
    return selection.shapeCount ? `Delete ${n} items` : `Delete ${n} fixtures`;
}

/** Right-click on a shape (stage, truss, roof...). Acts on the selection, which includes the shape. */
export function shapeMenu(clickedId: string): MenuItem[] {
    const shape = live.shape(clickedId);
    const shapes = selection.shapes;
    const n = selection.size + selection.shapeCount;
    const items: MenuItem[] = [{heading: n > 1 ? `${n} items` : (shape?.name ?? 'Shape')}];
    if (!live.readonly) {
        items.push(
            {label: 'Edit', action: () => ui.show('fixture')},
            {label: 'Duplicate', shortcut: `${mod}D`, action: () => act.duplicateSelection()},
            {
                label: 'Rotate',
                children: ROTATIONS.map((deg) => ({
                    label: `${deg}°`,
                    checked: shapes.every((s) => (s.rotation ?? 0) === deg),
                    action: () => act.updateShapes(shapes.map((s) => ({id: s.id, rotation: deg || null}))),
                })),
            },
        );
    }
    items.push({label: 'Select fixtures on it', action: () => act.selectOnShape(clickedId)});
    if (!live.readonly) items.push(sep, {label: deleteLabel(), shortcut: '⌫', danger: true, action: () => act.deleteSelection()});
    return items;
}

/** Right-click on empty canvas. `at` is the canvas position clicked (world units). */
export function canvasMenu(at: {x: number; y: number}): MenuItem[] {
    const history = live.state?.history;
    const hasFixtures = live.fixtures.length > 0;
    const zoom: MenuItem[] = [
        {label: 'Zoom to fit', shortcut: '0', action: () => view.fit()},
        {label: 'Zoom to 100%', shortcut: '1', action: () => view.zoomTo(1)},
    ];
    if (live.readonly) {
        return [
            {label: 'Select all fixtures', shortcut: `${mod}A`, disabled: !hasFixtures, action: () => selection.selectAll()},
            ...zoom,
            sep,
            {label: 'How to connect…', action: () => (ui.helpOpen = true)},
        ];
    }
    return [
        {label: 'Add fixtures here…', action: () => act.openAddDialog(at)},
        {label: 'Add shape here', children: addShapeItems(at)},
        sep,
        {label: 'Select all fixtures', shortcut: `${mod}A`, disabled: !hasFixtures, action: () => selection.selectAll()},
        {label: 'Auto-arrange fixtures', disabled: !hasFixtures, action: () => act.arrange()},
        ...zoom,
        sep,
        {label: history?.undoLabel ? `Undo ${history.undoLabel}` : 'Undo', shortcut: `${mod}Z`, disabled: !history?.canUndo, action: () => act.undo()},
        {label: history?.redoLabel ? `Redo ${history.redoLabel}` : 'Redo', shortcut: act.isMac ? '⇧⌘Z' : 'Ctrl+Y', disabled: !history?.canRedo, action: () => act.redo()},
        sep,
        {label: 'Rig settings…', action: () => ui.show('patch')},
        {label: 'How to connect…', action: () => (ui.helpOpen = true)},
    ];
}
