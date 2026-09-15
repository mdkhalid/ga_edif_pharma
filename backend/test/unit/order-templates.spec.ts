import { renderOrderPlaced } from '../../src/modules/notifications/domain/order-templates';

describe('renderOrderPlaced', () => {
  it('renders an email subject, body and SMS with the order summary', () => {
    const template = renderOrderPlaced({
      orderId: '12345678-aaaa-bbbb-cccc-000000000000',
      total: '900.00',
      currency: 'INR',
      itemCount: 2,
      tenantName: 'Acme Pharma',
    });

    expect(template.emailSubject).toContain('12345678');
    expect(template.emailSubject).toContain('Acme Pharma');
    expect(template.emailBody).toContain('12345678-aaaa-bbbb-cccc-000000000000');
    expect(template.emailBody).toContain('INR 900.00');
    expect(template.smsBody).toContain('2 items');
  });

  it('uses the singular for one item', () => {
    const template = renderOrderPlaced({
      orderId: 'order-1',
      total: '42.50',
      currency: 'INR',
      itemCount: 1,
      tenantName: 'Acme Pharma',
    });

    expect(template.smsBody).toContain('1 item ·');
    expect(template.smsBody).not.toContain('1 items');
  });
});
