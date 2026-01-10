#!/usr/bin/env python3
"""Test script for DHIS2 column name sanitization"""

import re

def sanitize_dhis2_column_name(name):
    """Sanitize DHIS2 column names for Superset compatibility.
    
    Replaces all special characters with underscores to prevent layout distortions.
    """
    # Replace all non-alphanumeric characters (except underscore) with underscore
    name = re.sub(r'[^\w]', '_', name)
    # Replace multiple consecutive underscores with single underscore
    name = re.sub(r'_+', '_', name)
    # Remove leading/trailing underscores
    name = name.strip('_')
    return name


def sanitize_metric_expression(expression):
    """Sanitize metric expressions like SUM(col), AVG(col), etc.
    
    Extracts inner column from aggregate wrapper, sanitizes it, then re-wraps.
    Examples:
        SUM(105-EP01a. Suspected fever) -> SUM(105_EP01a_Suspected_fever)
        AVG(col-name with spaces) -> AVG(col_name_with_spaces)
        plain_column -> plain_column (no wrapper, sanitize directly)
    """
    # Check if expression is a wrapped aggregate function
    agg_wrapper_match = re.match(r'^(SUM|AVG|COUNT|MIN|MAX|MEDIAN|STDDEV|VAR)\((.+)\)$', expression, re.IGNORECASE)
    
    if agg_wrapper_match:
        # Extract wrapper function and inner column
        agg_func = agg_wrapper_match.group(1).upper()  # Normalize to uppercase
        inner_column = agg_wrapper_match.group(2)
        
        # Sanitize the inner column
        sanitized_inner = sanitize_dhis2_column_name(inner_column)
        
        # Reconstruct with wrapper
        if sanitized_inner != inner_column:
            return f"{agg_func}({sanitized_inner})"
        else:
            return expression
    else:
        # Not wrapped - sanitize the expression directly
        return sanitize_dhis2_column_name(expression)

test_names = [
    '105-EP01b. Malaria Total',
    '105-EP01a. Suspected fever',
    '105-EP01c. Malaria Confirmed (B/s and RDT Positive)',
    '105-EP01d. Malaria cases treated',
    'Cases - Confirmed & Probable',
    'Confirmed/Suspected/Probable',
    'Data (Element)',
    'Col@Name#With$Special%Chars',
    'Test™ with © symbols',
    'Name/With\\Backslash',
]

print('Column Name Sanitization Results:')
print('=' * 60)
for name in test_names:
    sanitized = sanitize_dhis2_column_name(name)
    print(f'Original:  {name}')
    print(f'Sanitized: {sanitized}')
    print('-' * 60)

print('\n\nMetric Expression Sanitization Results:')
print('(Extracts inner column, sanitizes it, then re-wraps)')
print('=' * 60)

metric_expressions = [
    'SUM(105-EP01b. Malaria Total)',
    'AVG(105-EP01a. Suspected fever)',
    'COUNT(105-EP01c. Malaria Confirmed (B/s and RDT Positive))',
    'MIN(Cases - Confirmed & Probable)',
    'MAX(Confirmed/Suspected/Probable)',
    'sum(Data (Element))',  # lowercase - tests case insensitivity
    'avg(Col@Name#With$Special%Chars)',  # lowercase
    'MEDIAN(Test™ with © symbols)',
    'plain_column_no_wrapper',  # Test plain column without wrapper
    '105-EP01a. Suspected fever',  # Test plain column with special chars
]

for expr in metric_expressions:
    sanitized = sanitize_metric_expression(expr)
    print(f'Original:  {expr}')
    print(f'Sanitized: {sanitized}')
    print('-' * 60)
