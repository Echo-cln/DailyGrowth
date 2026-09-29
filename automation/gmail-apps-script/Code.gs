/**
 * DailyGlow Gmail bridge
 *
 * Put DAILYGLOW_IMPORT_URL and DAILYGLOW_IMPORT_KEY in Apps Script
 * Project Settings > Script properties. Do not put either value in this file.
 */
const IMPORTED_LABEL = 'DailyGlow/Imported';

function setupDailyGlowBridge() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'importDailyGlowEmails')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  GmailApp.getUserLabelByName(IMPORTED_LABEL) || GmailApp.createLabel(IMPORTED_LABEL);
  ScriptApp.newTrigger('importDailyGlowEmails').timeBased().everyMinutes(5).create();
}

function importDailyGlowEmails() {
  const props = PropertiesService.getScriptProperties();
  const endpoint = requiredProperty_(props, 'DAILYGLOW_IMPORT_URL');
  const key = requiredProperty_(props, 'DAILYGLOW_IMPORT_KEY');
  const label = GmailApp.getUserLabelByName(IMPORTED_LABEL);
  const query = 'newer_than:14d -label:"DailyGlow/Imported" {subject:"每日成长简报" subject:"每日基金策略简报" subject:"盘中风控复盘"}';
  GmailApp.search(query, 0, 100).forEach(thread => {
    thread.getMessages().forEach(message => {
      if (thread.getLabels().some(item => item.getName() === IMPORTED_LABEL)) return;
      const parsed = parseSubject_(message.getSubject());
      if (!parsed) return;
      const body = message.getPlainBody().trim();
      if (!body) throw new Error('邮件正文为空：' + message.getSubject());
      if (body.length > 90_000) throw new Error('邮件正文超过 90,000 字符，未导入：' + message.getSubject());
      const payload = {
        contentType: parsed.contentType,
        contentDate: parsed.contentDate,
        title: parsed.title,
        summary: '来自 ChatGPT 定时任务的完整邮件原文',
        payload: { document: { body, subject: message.getSubject(), receivedAt: message.getDate().toISOString(), gmailMessageId: message.getId() } },
      };
      const response = UrlFetchApp.fetch(endpoint, {
        method: 'post', contentType: 'application/json',
        headers: { 'x-dailyglow-import-key': key },
        payload: JSON.stringify(payload), muteHttpExceptions: true,
      });
      if (response.getResponseCode() < 200 || response.getResponseCode() >= 300)
        throw new Error('DailyGlow 导入失败：' + response.getResponseCode() + ' ' + response.getContentText());
      thread.addLabel(label);
    });
  });
}

function parseSubject_(subject) {
  const match = subject.match(/^(\d{4}-\d{2}-\d{2})\s*\|\s*(08:00|09:00|14:00)\s*(每日成长简报|每日基金策略简报|盘中风控复盘)\s*$/);
  if (!match) return null;
  const key = match[2] + match[3];
  const rules = {
    '08:00每日成长简报': { contentType: 'growth_brief', title: '每日成长简报' },
    '09:00每日基金策略简报': { contentType: 'fund_strategy', title: '每日基金策略简报' },
    '14:00盘中风控复盘': { contentType: 'market_intraday', title: '盘中风控复盘' },
  };
  return rules[key] ? { contentDate: match[1], ...rules[key] } : null;
}

function requiredProperty_(properties, name) {
  const value = properties.getProperty(name);
  if (!value) throw new Error('请在 Script properties 配置 ' + name);
  return value;
}
