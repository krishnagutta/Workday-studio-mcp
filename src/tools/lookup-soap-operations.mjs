import { z } from 'zod';

/**
 * Workday Web Services (WWS) v46.1 — 2026R1
 * Source: https://community.workday.com/sites/default/files/file-hosting/productionapi/index.html
 * Last verified: 2026-05-29
 */
const WWS_VERSION = 'v46.1';
const WWS_BASE_URL = 'https://community.workday.com/sites/default/files/file-hosting/productionapi';
const WWS_INDEX_URL = `${WWS_BASE_URL}/index.html`;

const SERVICES = {
  // HCM Core
  Human_Resources: {
    category: 'HCM Core',
    wsdl: `${WWS_BASE_URL}/Human_Resources/${WWS_VERSION}/Human_Resources.wsdl`,
    common_operations: [
      'Get_Workers', 'Get_Organizations', 'Change_Personal_Information',
      'Change_Work_Contact_Information', 'Change_Home_Contact_Information',
      'Change_Legal_Name', 'Change_Government_IDs', 'Change_Passports_and_Visas',
      'Change_Emergency_Contacts', 'Add_Update_Organization', 'Find_Organization',
      'Add_Workday_Account', 'Change_Business_Title', 'Change_Person_Photo',
    ],
    notes: 'Broadest HCM service. Get_Workers is the primary read operation for worker data.',
  },
  Staffing: {
    category: 'HCM Core',
    wsdl: `${WWS_BASE_URL}/Staffing/${WWS_VERSION}/Staffing.wsdl`,
    common_operations: [
      'Hire_Employee', 'Contract_Contingent_Worker', 'Change_Job', 'Correct_Hire_Employee',
      'Correct_Change_Job', 'End_Additional_Job', 'End_Contingent_Worker_Contract',
      'Get_Applicants', 'Create_Position', 'Edit_Position', 'Close_Position',
      'Assign_Organization', 'Assign_Roles', 'Edit_Worker_Additional_Data',
      'Delete_Worker_Document',
    ],
    notes: 'Primary service for hire/terminate/change-job lifecycle events.',
  },
  Compensation: {
    category: 'HCM Core',
    wsdl: `${WWS_BASE_URL}/Compensation/${WWS_VERSION}/Compensation.wsdl`,
    common_operations: [
      'Add_Stock_Grant', 'Create_Severance_Worksheet',
      'Assign_Eligible_Period_Activities_for_Employee',
    ],
    notes: 'Compensation changes. Most comp changes go via Change_Job in Staffing.',
  },
  Talent: {
    category: 'HCM Core',
    wsdl: `${WWS_BASE_URL}/Talent/${WWS_VERSION}/Talent.wsdl`,
    common_operations: ['Assess_Talent', 'Get_Assess_Talent', 'Edit_Career_Interests'],
    notes: 'Performance, talent assessments, and career development.',
  },
  Performance_Management: {
    category: 'HCM Core',
    wsdl: `${WWS_BASE_URL}/Performance_Management/${WWS_VERSION}/Performance_Management.wsdl`,
    common_operations: ['Bulk_Import_Update_Employee_Review_Rating'],
    notes: 'Employee review ratings and performance data.',
  },
  Recruiting: {
    category: 'HCM Core',
    wsdl: `${WWS_BASE_URL}/Recruiting/${WWS_VERSION}/Recruiting.wsdl`,
    common_operations: [
      'Create_Job_Requisition', 'Edit_Job_Requisition', 'Close_Job_Requisition',
      'Get_Applicants', 'Assess_Candidate', 'Bulk_Import_Put_Candidate',
    ],
    notes: 'Recruiting and applicant tracking.',
  },
  Learning: {
    category: 'HCM Core',
    wsdl: `${WWS_BASE_URL}/Learning/${WWS_VERSION}/Learning.wsdl`,
    common_operations: [
      'Enroll_In_Learning_Content', 'Cancel_Learning_Enrollment',
      'Admin_Drop_Learning_Enrollment', 'Get_Archived_External_Learning_User',
    ],
    notes: 'Learning enrollment and course management.',
  },
  Flex_Team: {
    category: 'HCM Core',
    wsdl: `${WWS_BASE_URL}/Flex_Team/${WWS_VERSION}/Flex_Team.wsdl`,
    common_operations: ['Add_Flex_Team_Members', 'Complete_Flex_Team'],
    notes: 'Flex/gig team management.',
  },
  Adoption: {
    category: 'HCM Core',
    wsdl: `${WWS_BASE_URL}/Adoption/${WWS_VERSION}/Adoption.wsdl`,
    common_operations: ['Get_Adoption_Items'],
    notes: 'Adoption benefit tracking.',
  },

  // Payroll
  Payroll: {
    category: 'Payroll',
    wsdl: `${WWS_BASE_URL}/Payroll/${WWS_VERSION}/Payroll.wsdl`,
    common_operations: ['Assign_Costing_Allocation', 'Assign_Pay_Group', 'Get_Advanced_Lookup_Tables'],
    notes: 'Payroll processing and costing. For outbound payroll file integrations use Payroll_Interface.',
  },
  Payroll_Interface: {
    category: 'Payroll',
    wsdl: `${WWS_BASE_URL}/Payroll_Interface/${WWS_VERSION}/Payroll_Interface.wsdl`,
    common_operations: ['Get_Payroll_Results', 'Get_Worker_Tax_Levy_Data', 'Get_Payroll_Inputs'],
    notes: 'The correct service for outbound payroll integrations that extract pay results. NOT the same as Payroll.',
  },
  Payroll_GBR: {
    category: 'Payroll',
    wsdl: `${WWS_BASE_URL}/Payroll_GBR/${WWS_VERSION}/Payroll_GBR.wsdl`,
    common_operations: ['Get_AEO_Council_Tax_Orders', 'Get_AEO_Non_Priority_Orders'],
    notes: 'UK-specific payroll — attachment of earnings orders.',
  },
  Payroll_AUS: {
    category: 'Payroll',
    wsdl: `${WWS_BASE_URL}/Payroll_AUS/${WWS_VERSION}/Payroll_AUS.wsdl`,
    common_operations: ['Get_Australia_Withholding_Orders'],
    notes: 'Australia-specific payroll.',
  },

  // Benefits & Time
  Benefits_Administration: {
    category: 'Benefits & Time',
    wsdl: `${WWS_BASE_URL}/Benefits_Administration/${WWS_VERSION}/Benefits_Administration.wsdl`,
    common_operations: [
      'Change_Benefits', 'Add_Dependent', 'Edit_Dependent', 'Change_Beneficiary',
      'Enroll_in_Retirement_Savings_Plans', 'Get_ACA_1095-C_Forms_Data',
    ],
    notes: 'Benefits enrollment and dependent management.',
  },
  Benefits_Partner_Program_Integrations: {
    category: 'Benefits & Time',
    wsdl: `${WWS_BASE_URL}/Benefits_Partner_Program_Integrations/${WWS_VERSION}/Benefits_Partner_Program_Integrations.wsdl`,
    common_operations: ['Bulk_Import_Put_Worker_Benefit_and_Wellbeing_Wallet_Cards'],
    notes: 'Benefits partner integrations — wallet cards, wellbeing.',
  },
  Absence_Management: {
    category: 'Benefits & Time',
    wsdl: `${WWS_BASE_URL}/Absence_Management/${WWS_VERSION}/Absence_Management.wsdl`,
    common_operations: ['Enter_Time_Off', 'Adjust_Time_Off', 'Get_Absence_Inputs', 'Get_Accrual_Expiration_Overrides'],
    notes: 'Time off entry, accruals, and absence management.',
  },
  Time_Tracking: {
    category: 'Benefits & Time',
    wsdl: `${WWS_BASE_URL}/Time_Tracking/${WWS_VERSION}/Time_Tracking.wsdl`,
    common_operations: ['Assign_Work_Schedule'],
    notes: 'Time entry and work schedule management.',
  },

  // Finance
  Financial_Management: {
    category: 'Finance',
    wsdl: `${WWS_BASE_URL}/Financial_Management/${WWS_VERSION}/Financial_Management.wsdl`,
    common_operations: [
      'Bulk_Import_Submit_Accounting_Journal', 'Cancel_Accounting_Journal',
      'Get_Account_Sets', 'Get_Allocation_Definitions',
    ],
    notes: 'General ledger, journal entries, account management.',
  },
  Revenue_Management: {
    category: 'Finance',
    wsdl: `${WWS_BASE_URL}/Revenue_Management/${WWS_VERSION}/Revenue_Management.wsdl`,
    common_operations: ['Cancel_Customer_Invoice', 'Cancel_Customer_Contract', 'Get_Award_Additional_Data'],
    notes: 'Customer invoicing, contracts, and award management.',
  },
  Cash_Management: {
    category: 'Finance',
    wsdl: `${WWS_BASE_URL}/Cash_Management/${WWS_VERSION}/Cash_Management.wsdl`,
    common_operations: ['Cancel_Ad_Hoc_Payment', 'Get_Ad_Hoc_Payments', 'Get_Ad_Hoc_Bank_Transactions'],
    notes: 'Cash, payments, and banking.',
  },
  Resource_Management: {
    category: 'Finance',
    wsdl: `${WWS_BASE_URL}/Resource_Management/${WWS_VERSION}/Resource_Management.wsdl`,
    common_operations: ['Cancel_Purchase_Order', 'Cancel_Supplier_Invoice', 'Get_Assets', 'Bulk_Import_Submit_Supplier'],
    notes: 'Procurement, supplier invoices, asset management.',
  },
  Inventory: {
    category: 'Finance',
    wsdl: `${WWS_BASE_URL}/Inventory/${WWS_VERSION}/Inventory.wsdl`,
    common_operations: ['Cancel_Goods_Delivery', 'Bulk_Import_Submit_Inventory_Par_Count'],
    notes: 'Inventory and warehouse management.',
  },
  Requests: {
    category: 'Finance',
    wsdl: `${WWS_BASE_URL}/Requests/${WWS_VERSION}/Requests.wsdl`,
    common_operations: ['Bulk_Import_Submit_Request'],
    notes: 'General request management.',
  },
  Settlement_Services: {
    category: 'Finance',
    wsdl: `${WWS_BASE_URL}/Settlement_Services/${WWS_VERSION}/Settlement_Services.wsdl`,
    common_operations: ['Cancel_Payment_Return'],
    notes: 'Payment settlement processing.',
  },
  Compensation_Review: {
    category: 'Finance',
    wsdl: `${WWS_BASE_URL}/Compensation_Review/${WWS_VERSION}/Compensation_Review.wsdl`,
    common_operations: [
      'Bulk_Import_Put_Compensation_Review_Participation_Rule_Sets',
      'Bulk_Import_Put_Compensation_Review_Template',
    ],
    notes: 'Compensation review cycles and merit planning.',
  },
  Professional_Services_Automation: {
    category: 'Finance',
    wsdl: `${WWS_BASE_URL}/Professional_Services_Automation/${WWS_VERSION}/Professional_Services_Automation.wsdl`,
    common_operations: ['Cancel_Expense_Report_Old'],
    notes: 'Professional services and project tracking.',
  },

  // Academic (higher education tenants only)
  Academic_Foundation: {
    category: 'Academic',
    wsdl: `${WWS_BASE_URL}/Academic_Foundation/${WWS_VERSION}/Academic_Foundation.wsdl`,
    common_operations: ['Get_Academic_Areas', 'Get_Academic_Contacts', 'Get_Academic_Periods'],
    notes: 'Core academic data — periods, areas, contacts. Higher education tenants only.',
  },
  Academic_Advising: {
    category: 'Academic',
    wsdl: `${WWS_BASE_URL}/Academic_Advising/${WWS_VERSION}/Academic_Advising.wsdl`,
    common_operations: ['Get_Academic_Progress_for_Student', 'Get_Academic_Requirements_Effective_Date'],
    notes: 'Student advising and academic progress. Higher education tenants only.',
  },
  Admissions: {
    category: 'Academic',
    wsdl: `${WWS_BASE_URL}/Admissions/${WWS_VERSION}/Admissions.wsdl`,
    common_operations: ['Get_Admissions_Committees', 'Get_Application_Groupings'],
    notes: 'Admissions management. Higher education tenants only.',
  },
  Student_Core: {
    category: 'Academic',
    wsdl: `${WWS_BASE_URL}/Student_Core/${WWS_VERSION}/Student_Core.wsdl`,
    common_operations: ['Add_Student_Document', 'Delete_Student_Document', 'Get_Accommodations_for_Student'],
    notes: 'Core student data. Higher education tenants only.',
  },
  Student_Records: {
    category: 'Academic',
    wsdl: `${WWS_BASE_URL}/Student_Records/${WWS_VERSION}/Student_Records.wsdl`,
    common_operations: ['Bulk_Import_Put_Historical_Academic_Record', 'Bulk_Import_Submit_Program_Completion'],
    notes: 'Student transcripts and academic records. Higher education tenants only.',
  },
  Student_Finance: {
    category: 'Academic',
    wsdl: `${WWS_BASE_URL}/Student_Finance/${WWS_VERSION}/Student_Finance.wsdl`,
    common_operations: ['Get_1098-T', 'Bulk_Import_Submit_Student_Sponsor_Invoice'],
    notes: 'Student billing and financial aid. Higher education tenants only.',
  },
  Student_Transfer_Credit: {
    category: 'Academic',
    wsdl: `${WWS_BASE_URL}/Student_Transfer_Credit/${WWS_VERSION}/Student_Transfer_Credit.wsdl`,
    common_operations: ['Bulk_Import_Put_Preliminary_Transfer_Credit', 'Delete_Student_Transfer_Credits'],
    notes: 'Transfer credit management. Higher education tenants only.',
  },
  Student_Recruiting: {
    category: 'Academic',
    wsdl: `${WWS_BASE_URL}/Student_Recruiting/${WWS_VERSION}/Student_Recruiting.wsdl`,
    common_operations: ['Get_Ad_Hoc_Locations'],
    notes: 'Student recruiting. Higher education tenants only.',
  },

  // Platform
  Integrations: {
    category: 'Platform',
    wsdl: `${WWS_BASE_URL}/Integrations/${WWS_VERSION}/Integrations.wsdl`,
    common_operations: [
      'Launch_Integration_Event', 'Get_Integration_Events', 'Cancel_Integration_Event',
      'Get_Integration_Systems', 'Approve_Business_Process', 'Deny_Business_Process',
    ],
    notes: 'Launch and monitor integration events, manage business processes.',
  },
  Prism_Analytics: {
    category: 'Platform',
    wsdl: `${WWS_BASE_URL}/Prism_Analytics/${WWS_VERSION}/Prism_Analytics.wsdl`,
    common_operations: ['Get_Analytic_Dimension_Business_Objects', 'Get_Analytic_Dimension_Values'],
    notes: 'Prism analytics dimensions and data lake operations.',
  },
  Workday_Connect: {
    category: 'Platform',
    wsdl: `${WWS_BASE_URL}/Workday_Connect/${WWS_VERSION}/Workday_Connect.wsdl`,
    common_operations: ['Get_Audience_Builder'],
    notes: 'Workday Connect audience management.',
  },
  ACA_Partner_Integrations: {
    category: 'Platform',
    wsdl: `${WWS_BASE_URL}/ACA_Partner_Integrations/${WWS_VERSION}/ACA_Partner_Integrations.wsdl`,
    common_operations: ['Get_ACA_Employee_Data', 'Get_ACA_Employer_Data'],
    notes: 'ACA (Affordable Care Act) reporting data for benefits partners.',
  },
};

export function register(server) {
  server.tool(
    'lookup_soap_operations',
    `Look up Workday SOAP web service operations for use in cc:workday-out-soap steps. \
Returns the valid application name, common operations, WSDL URL, and notes for a given service. \
Use this before writing a cc:workday-out-soap step to confirm the correct application name and \
what operations are available. Pass service_name="list" to see all 37 services grouped by category.`,
    {
      service_name: z.string().describe(
        'Workday service name (e.g. "Human_Resources", "Staffing", "Payroll_Interface") or "list" to see all services'
      ),
    },
    async ({ service_name }) => {
      if (service_name.toLowerCase() === 'list') {
        const grouped = {};
        for (const [name, svc] of Object.entries(SERVICES)) {
          if (!grouped[svc.category]) grouped[svc.category] = [];
          grouped[svc.category].push(name);
        }

        const lines = [
          `Workday Web Services — ${WWS_VERSION} (2026R1)`,
          `Source: ${WWS_INDEX_URL}`,
          '',
        ];
        for (const [cat, names] of Object.entries(grouped)) {
          lines.push(`${cat}:`);
          lines.push(`  ${names.join(', ')}`);
        }
        lines.push('');
        lines.push('Use service_name="<name>" for details and common operations.');

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      // Fuzzy match — allow case-insensitive and partial match
      const key = Object.keys(SERVICES).find(
        k => k.toLowerCase() === service_name.toLowerCase()
      ) || Object.keys(SERVICES).find(
        k => k.toLowerCase().includes(service_name.toLowerCase())
      );

      if (!key) {
        const allNames = Object.keys(SERVICES).join(', ');
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: true,
              code: 'SERVICE_NOT_FOUND',
              message: `No service matching "${service_name}" in WWS ${WWS_VERSION}.`,
              suggestion: `Valid service names: ${allNames}. Use service_name="list" for the grouped list.`,
            }, null, 2),
          }],
        };
      }

      const svc = SERVICES[key];
      const result = {
        service: key,
        category: svc.category,
        wws_version: WWS_VERSION,
        wsdl_url: svc.wsdl,
        notes: svc.notes,
        common_operations: svc.common_operations,
        assembly_usage: `<cc:workday-out-soap id="Call${key.replace(/_/g, '')}" application="${key}" version="${WWS_VERSION}" routes-response-to="HandleResponse"/>`,
        full_operations_reference: `${WWS_BASE_URL}/operations/index.html`,
      };

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}
