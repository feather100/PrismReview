import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PRESET_ROLES = [
  {
    name: '技术审核员',
    code: 'CTO',
    systemPrompt: `你是技术审核员（CTO），负责从技术角度审查方案。
你的核心职责是识别架构风险、性能瓶颈、安全隐患、技术债务和可行性问题。
你必须输出结构化JSON，遵循指定的output_schema。
不得编造知识库引用。没有证据时 citations 为空，并降低 confidence_score。`,
    dimensions: ['架构合理性', '技术可行性', '性能与扩展性', '安全与合规', '技术债务'],
    outputSchema: {
      type: 'object',
      properties: {
        dimension: { type: 'string' },
        risk_level: { type: 'string', enum: ['high', 'medium', 'low', 'info'] },
        issue: { type: 'string' },
        evidence_citations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              chunk_id: { type: 'string' },
              document: { type: 'string' },
              page: { type: 'number' },
            },
          },
        },
        recommendation: { type: 'string' },
        confidence_score: { type: 'number', minimum: 0, maximum: 100 },
        reasoning_summary: { type: 'string' },
      },
      required: ['dimension', 'risk_level', 'issue', 'recommendation', 'confidence_score'],
    },
  },
  {
    name: '商业控制者',
    code: 'CFO',
    systemPrompt: `你是商业控制者（CFO），负责从商业和财务角度审查方案。
你的核心职责是评估投入产出、预算合理性、ROI、商业风险和成本效益。
你必须输出结构化JSON，遵循指定的output_schema。
不得编造知识库引用。没有证据时 citations 为空，并降低 confidence_score。`,
    dimensions: ['投入产出分析', '预算合理性', 'ROI评估', '商业风险', '成本效益'],
    outputSchema: {
      type: 'object',
      properties: {
        dimension: { type: 'string' },
        risk_level: { type: 'string', enum: ['high', 'medium', 'low', 'info'] },
        issue: { type: 'string' },
        evidence_citations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              chunk_id: { type: 'string' },
              document: { type: 'string' },
              page: { type: 'number' },
            },
          },
        },
        recommendation: { type: 'string' },
        confidence_score: { type: 'number', minimum: 0, maximum: 100 },
        reasoning_summary: { type: 'string' },
      },
      required: ['dimension', 'risk_level', 'issue', 'recommendation', 'confidence_score'],
    },
  },
  {
    name: '交付守护者',
    code: 'PMO',
    systemPrompt: `你是交付守护者（PMO），负责从项目和交付角度审查方案。
你的核心职责是识别排期风险、资源冲突、依赖问题、延期可能性和交付质量风险。
你必须输出结构化JSON，遵循指定的output_schema。
不得编造知识库引用。没有证据时 citations 为空，并降低 confidence_score。`,
    dimensions: ['排期可行性', '资源分配', '依赖管理', '交付风险', '质量控制'],
    outputSchema: {
      type: 'object',
      properties: {
        dimension: { type: 'string' },
        risk_level: { type: 'string', enum: ['high', 'medium', 'low', 'info'] },
        issue: { type: 'string' },
        evidence_citations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              chunk_id: { type: 'string' },
              document: { type: 'string' },
              page: { type: 'number' },
            },
          },
        },
        recommendation: { type: 'string' },
        confidence_score: { type: 'number', minimum: 0, maximum: 100 },
        reasoning_summary: { type: 'string' },
      },
      required: ['dimension', 'risk_level', 'issue', 'recommendation', 'confidence_score'],
    },
  },
  {
    name: '合规审查员',
    code: 'Compliance',
    systemPrompt: `你是合规审查员（Compliance），负责从法规和合规角度审查方案。
你的核心职责是检查法规遵从性、隐私保护、数据安全、许可证合规和行业标准。
你必须输出结构化JSON，遵循指定的output_schema。
不得编造知识库引用。没有证据时 citations 为空，并降低 confidence_score。`,
    dimensions: ['法规遵从', '隐私保护', '数据安全', '许可证合规', '行业标准'],
    outputSchema: {
      type: 'object',
      properties: {
        dimension: { type: 'string' },
        risk_level: { type: 'string', enum: ['high', 'medium', 'low', 'info'] },
        issue: { type: 'string' },
        evidence_citations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              chunk_id: { type: 'string' },
              document: { type: 'string' },
              page: { type: 'number' },
            },
          },
        },
        recommendation: { type: 'string' },
        confidence_score: { type: 'number', minimum: 0, maximum: 100 },
        reasoning_summary: { type: 'string' },
      },
      required: ['dimension', 'risk_level', 'issue', 'recommendation', 'confidence_score'],
    },
  },
  {
    name: '用户代言人',
    code: 'UserAdvocate',
    systemPrompt: `你是用户代言人（UserAdvocate），负责从用户体验角度审查方案。
你的核心职责是评估用户体验、认知负荷、可访问性、可用性和学习成本。
你必须输出结构化JSON，遵循指定的output_schema。
不得编造知识库引用。没有证据时 citations 为空，并降低 confidence_score。`,
    dimensions: ['用户体验', '认知负荷', '可访问性', '可用性', '学习成本'],
    outputSchema: {
      type: 'object',
      properties: {
        dimension: { type: 'string' },
        risk_level: { type: 'string', enum: ['high', 'medium', 'low', 'info'] },
        issue: { type: 'string' },
        evidence_citations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              chunk_id: { type: 'string' },
              document: { type: 'string' },
              page: { type: 'number' },
            },
          },
        },
        recommendation: { type: 'string' },
        confidence_score: { type: 'number', minimum: 0, maximum: 100 },
        reasoning_summary: { type: 'string' },
      },
      required: ['dimension', 'risk_level', 'issue', 'recommendation', 'confidence_score'],
    },
  },
];

async function main() {
  console.log('🌱 Seeding preset roles...');

  // Create a system tenant if none exists
  const tenant = await prisma.tenant.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'System',
      region: 'cn',
      status: 'active',
    },
  });
  console.log(`  ✓ System tenant: ${tenant.id}`);

  // Create a mock user for development
  await prisma.user.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      tenantId: tenant.id,
      email: 'mock@prismreview.dev',
      name: 'Mock User',
      passwordHash: 'mock',
      platformRole: 'enterprise_admin',
      status: 'active',
    },
  });
  console.log(`  ✓ Mock user: 00000000-...0001`);

  for (const role of PRESET_ROLES) {
    const existingRole = await prisma.agentRole.findFirst({
      where: {
        tenantId: tenant.id,
        code: role.code,
      },
    });

    if (existingRole) {
      console.log(`  - Skipping ${role.code} (already exists)`);
      continue;
    }

    const createdRole = await prisma.agentRole.create({
      data: {
        tenantId: tenant.id,
        name: role.name,
        code: role.code,
        type: 'preset',
        status: 'enabled',
      },
    });

    const version = await prisma.agentRoleVersion.create({
      data: {
        roleId: createdRole.id,
        version: 1,
        systemPrompt: role.systemPrompt,
        dimensions: JSON.parse(JSON.stringify(role.dimensions)),
        outputSchema: JSON.parse(JSON.stringify(role.outputSchema)),
        knowledgeCollectionIds: [],
        createdBy: '00000000-0000-0000-0000-000000000000',
      },
    });

    await prisma.agentRole.update({
      where: { id: createdRole.id },
      data: { activeVersionId: version.id },
    });

    console.log(`  ✓ ${role.code} (${role.name}) — version 1 active`);
  }

  console.log('✅ Seed complete: 5 preset roles ready');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
