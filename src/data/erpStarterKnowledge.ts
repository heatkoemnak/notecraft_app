import { KnowledgeEntry } from '../types/knowledge';

export function buildMaqsuStarterKnowledgeTemplates(): KnowledgeEntry[] {
  const now = Date.now();
  return [
    {
      id: 'maqsu-tpl-project-structure',
      systemName: 'MAQSU ERP',
      category: 'project_structure',
      title: 'MAQSU ERP Project Structure & Custom Addons Layout',
      summary:
        'GitLab repository layout, addons paths, custom modules, __manifest__.py dependencies, Python/XML/JS structure, and odoo.conf.',
      tags: [
        'maqsu',
        'project structure',
        'gitlab',
        'addons',
        '__manifest__.py',
        'odoo.conf',
        'python',
        'xml',
        'javascript',
      ],
      filePaths: ['odoo.conf', 'addons/', 'custom_addons/'],
      sourceType: 'template',
      enabled: true,
      createdAt: now,
      updatedAt: now,
      content: `## MAQSU ERP Project Layout (Starter Blueprint — Customize or Run SSH Scan)

### Typical Directory & File Conventions
- **Core / Enterprise / Base Addons**: Upstream ERP modules (never modify directly).
- **Custom Addons (\`custom_addons/\` or \`maqsu_addons/\`)**: Custom MAQSU ERP modules tracked in GitLab.
- **Per-Module Structure**:
  - \`__init__.py\` — Imports \`models\`, \`wizard\`, \`controllers\`, \`report\`
  - \`__manifest__.py\` — Declares \`name\`, \`version\`, \`depends\`, \`data\` (security CSV/XML, views, menus, reports), and \`assets\` (JS/CSS/QWeb)
  - \`models/*.py\` — ORM models (\`_name\`, \`_inherit\`)
  - \`views/*.xml\` — Form, tree/list, search, kanban views, actions, menus
  - \`security/ir.model.access.csv\` — Model ACLs (\`perm_read\`, \`perm_write\`, \`perm_create\`, \`perm_unlink\`)
  - \`security/*.xml\` — Security groups and \`ir.rule\` multi-company/record rules
  - \`static/src/js/\` & \`static/src/xml/\` — OWL / JavaScript client components & templates
- **Configuration**: \`odoo.conf\` defines \`addons_path\`, \`db_host\`, \`db_name\`, \`db_user\`, worker limits, and proxy mode.

> **Action for AI**: Always inspect \`__manifest__.py\`, \`addons_path\`, and existing module folders via workspace search before adding new files or dependencies.`,
    },
    {
      id: 'maqsu-tpl-database-structure',
      systemName: 'MAQSU ERP',
      category: 'database_structure',
      title: 'MAQSU ERP Database Structure, ORM Models, ACLs & Record Rules',
      summary:
        'ORM-to-PostgreSQL table mapping, field relationships (Many2one/One2many/Many2many), ir.model.access.csv, and ir.rule conventions.',
      tags: [
        'database',
        'postgresql',
        'models',
        'fields',
        'many2one',
        'one2many',
        'many2many',
        'ir.model.access.csv',
        'ir.rule',
        'security',
        '_inherit',
      ],
      models: ['ir.model.access', 'ir.rule', 'res.partner'],
      filePaths: ['security/ir.model.access.csv'],
      sourceType: 'template',
      enabled: true,
      createdAt: now,
      updatedAt: now,
      content: `## Database & Security Conventions in MAQSU ERP

### ORM & PostgreSQL Mapping
- ORM model \`_name = 'vehicle.visit'\` maps to PostgreSQL table \`vehicle_visit\` (dots become underscores).
- When extending an existing model via \`_inherit = 'vehicle.visit'\` without \`_name\`, new Python \`fields.*\` columns are added to the **existing** \`vehicle_visit\` table upon module upgrade (\`-u <module>\`).
- Always index high-cardinality foreign keys and search fields (\`index=True\`), set \`tracking=True\` on audit-sensitive state/owner fields when \`mail.thread\` is inherited, and specify explicit \`ondelete\` (\`'cascade'\`, \`'restrict'\`, \`'set null'\`) on relational \`Many2one\` fields where appropriate.

### Security & Record Rules Checklist
1. **New Models**: Every new \`_name\` model MUST have entries in \`security/ir.model.access.csv\` referencing valid \`res.groups\` and \`model_<underscored_name>\`.
2. **Existing Model Extensions**: Verify whether new fields carry \`groups="..."\` restrictions or affect multi-company \`ir.rule\` domains.
3. **Computed Stored Fields**: Always decorate with \`@api.depends(...)\` so PostgreSQL values stay synchronized.`,
    },
    {
      id: 'maqsu-tpl-vehicle-service',
      systemName: 'MAQSU ERP',
      category: 'business_logic',
      title: 'Vehicle Service (vehicle.visit) Business Logic & Sales/Inventory Integration',
      summary:
        'End-to-end Vehicle Service flow: vehicle.visit lifecycle, vehicle & customer linkage, Sales quotations/orders, and Inventory spare parts consumption.',
      tags: [
        'vehicle.visit',
        'vehicle_visit',
        'vehicle service',
        'fleet.vehicle',
        'res.partner',
        'sale.order',
        'stock.picking',
        'stock.move',
        'inventory',
        'sales',
        'service',
      ],
      models: [
        'vehicle.visit',
        'fleet.vehicle',
        'res.partner',
        'sale.order',
        'sale.order.line',
        'stock.picking',
        'stock.move',
        'product.product',
      ],
      sourceType: 'template',
      enabled: true,
      createdAt: now,
      updatedAt: now,
      content: `## Vehicle Service Domain Blueprint (MAQSU ERP)

### Core Relationships & Entities
- **\`vehicle.visit\`**: Central workshop / service visit record tracking check-in, mileage/odometer, diagnosis/symptoms, technician/bay assignment, service lines, parts used, and workflow states (draft -> check-in -> in progress -> done / invoiced).
- **Vehicle & Customer Links**:
  - Links to the vehicle record (e.g. \`fleet.vehicle\` or custom vehicle model) and customer (\`res.partner\`).
  - Customer details, contact info, and vehicle plate/VIN/odometer history must stay consistent with \`res.partner\` and vehicle master records.
- **Sales Integration (\`sale.order\`)**:
  - Service labor and parts lines synchronize or generate \`sale.order\` / quotations and link back via \`Many2one\` / \`One2many\` references for customer billing & \`account.move\` invoicing.
  - Check existing state sync or button handlers before adding new billable or quotation-affecting fields.
- **Inventory Integration (\`stock.picking\` / \`stock.move\`)**:
  - Consumed spare parts trigger or link to warehouse stock pickings/deliveries or workshop internal transfers so \`stock.quant\` on-hand stock updates accurately.
  - Never deduct inventory manually outside stock moves/pickings.

> **Pre-Code Inspection Required**: Search the connected repo for \`vehicle.visit\`, its XML views, \`ir.model.access.csv\`, and references in Sales/Inventory extension modules before proposing any edits.`,
    },
    {
      id: 'maqsu-tpl-core-erp-flows',
      systemName: 'MAQSU ERP',
      category: 'business_logic',
      title: 'Core ERP Modules: Sales, Purchase, Inventory & Accounting Flows',
      summary:
        'Integration touchpoints across sale.order, purchase.order, stock.picking, product.template, and account.move in MAQSU ERP.',
      tags: [
        'sales',
        'purchase',
        'inventory',
        'accounting',
        'sale.order',
        'purchase.order',
        'stock.picking',
        'account.move',
        'product.template',
      ],
      models: [
        'sale.order',
        'purchase.order',
        'stock.picking',
        'stock.quant',
        'account.move',
        'product.template',
      ],
      sourceType: 'template',
      enabled: true,
      createdAt: now,
      updatedAt: now,
      content: `## Core ERP Cross-Module Flows

1. **Sales (\`sale.order\` -> \`stock.picking\` -> \`account.move\`)**:
   - Confirming a quotation reserves/creates delivery pickings (for storable products) and enables invoice creation.
   - Custom fields propagated from Sales to Delivery/Invoice must extend \`_prepare_invoice()\` or procurement/stock rule hooks rather than duplicating values manually.
2. **Purchase (\`purchase.order\` -> \`stock.picking\` -> vendor \`account.move\`)**:
   - Confirming RFQs creates incoming receipts and updates vendor bills / valuation layers.
3. **Inventory (\`stock.picking\`, \`stock.move\`, \`stock.quant\`)**:
   - All stock changes must go through validated \`stock.move\` / \`stock.picking\` transitions to preserve valuation, lot/serial traceability, and warehouse location balances.
4. **Accounting (\`account.move\`, \`account.move.line\`, \`account.payment\`)**:
   - Posted journal entries are immutable; never write raw updates to posted accounting lines.`,
    },
    {
      id: 'maqsu-tpl-development-rules',
      systemName: 'MAQSU ERP',
      category: 'development_rules',
      title: 'MAQSU ERP Development Rules, Conventions & Things to Avoid',
      summary:
        'Mandatory coding conventions, module dependencies, _inherit patterns, deployment steps, and strictly prohibited anti-patterns.',
      tags: [
        'rules',
        'conventions',
        'best practices',
        'avoid',
        'deployment',
        'dependencies',
        '_inherit',
        'xpath',
        'orm',
        'security',
      ],
      sourceType: 'template',
      enabled: true,
      createdAt: now,
      updatedAt: now,
      content: `## MAQSU ERP Development Rules (Strict Guidelines)

### 1. Inspect Before Writing Code
- ALWAYS read the existing module's \`__manifest__.py\`, model \`.py\`, \`views/*.xml\`, \`security/ir.model.access.csv\`, and related \`sale\`/\`stock\` extension files before proposing changes.
- Verify exact field names, \`inherit_id\` XML external IDs, and method signatures in the live codebase.

### 2. Module & Customization Patterns
- **Extend, Never Fork**: Use \`_inherit\` in Python and \`<field name="inherit_id" ref="..."/>\` with targeted \`<xpath>\` in XML instead of copying entire core views or editing core addons.
- **Explicit Dependencies**: Every model/view/group inherited from another module MUST list that module in \`__manifest__.py\` \`depends\`. Never introduce circular dependencies.
- **Security & Access Rights**: Add ACL rows in \`security/ir.model.access.csv\` for new models and register new XML/CSV files in \`__manifest__.py\` \`data\`.

### 3. Things Developers Must AVOID
- **Do NOT modify core/upstream Odoo addons directly** (breaks upgrades & merges).
- **Do NOT use raw SQL \`INSERT\`/\`UPDATE\`/\`DELETE\`** against ORM tables—use ORM (\`create\`, \`write\`, \`unlink\`) so \`@api.depends\`, constraints, tracking, and ACLs execute properly.
- **Do NOT abuse \`.sudo()\`**: Only escalate privileges in tightly scoped helper methods after verifying business permissions and \`company_id\`.
- **Do NOT leave N+1 queries inside loops**: Use \`read_group\`, \`search_read\`, or batched domain \`in\` lookups in computed methods.
- **Deployment / Upgrade Discipline**: Test \`-u <module>\` cleanly without breaking existing records (new \`required=True\` fields on populated tables need \`default=...\` or migration logic).`,
    },
    {
      id: 'maqsu-tpl-dev-history',
      systemName: 'MAQSU ERP',
      category: 'development_history',
      title: 'MAQSU ERP GitLab Workflow & Development History Log',
      summary:
        'Track GitLab branches, past bug fixes, architectural decisions, and known module issues (run SSH Repo Scan to auto-populate from Git).',
      tags: ['history', 'git', 'gitlab', 'branches', 'fixes', 'decisions', 'known issues'],
      sourceType: 'template',
      enabled: true,
      createdAt: now,
      updatedAt: now,
      content: `## Development History & GitLab Conventions

- Use **Scan Connected SSH Repo** inside the Knowledge Base manager to automatically import live Git branches, remote GitLab repository details, and recent commits into Development History.
- Record team architectural decisions, recurring bug fixes, and known module constraints here so the AI avoids repeating past regressions.`,
    },
  ];
}
