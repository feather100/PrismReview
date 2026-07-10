export const WEIRD_NAMES = ["技术审核员", "商业控制者", "交付守护者", "Technical Architect", "Product Manager", "Security Compliance", "QA", "Security"];

export const ROLE_MAP: Record<string, string> = {
  'CTO': '架构师',
  'CFO': '财务专家',
  'PMO': '项目经理',
  'Compliance': '合规专家',
  'UserAdvocate': '用户代表',
  // fallbacks if code matches old name
  'Technical Architect': '架构师',
  'Product Manager': '用户代表',
  'Security Compliance': '合规专家',
  'Security': '合规专家'
};

export function getRoleDisplayName(roleCode: string, roleName?: string): string {
  const effectiveName = roleName || roleCode;
  
  // If backend returns a Chinese name that is NOT in our weird/forbidden list, use it
  const hasChinese = /[\u4e00-\u9fa5]/.test(effectiveName);
  if (hasChinese && !WEIRD_NAMES.includes(effectiveName)) {
    return effectiveName;
  }
  
  // Otherwise try to map by code, then by name, then fallback to original
  return ROLE_MAP[roleCode] || ROLE_MAP[effectiveName] || effectiveName;
}
