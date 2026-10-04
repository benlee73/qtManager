use crate::{ApplicationError, Clock, DistributionDeskRepository, IdGenerator, RuntimeServices};
use qt_domain::{ChangeLog, Issue, OneTimePurchase};

pub fn record_group_distribution<R, C, I>(
    repository: &mut R,
    runtime: &RuntimeServices<'_, C, I>,
    person_id: &str,
    issue: Issue,
    quantity: u32,
) -> Result<String, ApplicationError>
where
    R: DistributionDeskRepository,
    C: Clock,
    I: IdGenerator,
{
    let person = repository
        .list_desk_records("", issue)?
        .into_iter()
        .find(|record| record.person.id == person_id && record.person.is_group)
        .ok_or(ApplicationError::MissingDeskRecord)?
        .person;
    let now = runtime.clock.now();
    let record = OneTimePurchase {
        id: runtime.ids.next_id(),
        person_id: Some(person.id),
        buyer_name: Some(person.name),
        issue,
        quantity,
        purchased_at: now.clone(),
        note: None,
        reversal_of: None,
        created_at: now.clone(),
        updated_at: now,
        payment_status: None,
        is_group_distribution: true,
    };
    record.validate()?;
    let change = group_change(repository, runtime, &record, false)?;
    repository.save_purchase(&record, &change)?;
    Ok(record.id)
}

pub fn cancel_group_distribution<R, C, I>(
    repository: &mut R,
    runtime: &RuntimeServices<'_, C, I>,
    person_id: &str,
    issue: Issue,
    purchase_id: &str,
) -> Result<(), ApplicationError>
where
    R: DistributionDeskRepository,
    C: Clock,
    I: IdGenerator,
{
    let group = repository
        .list_desk_records("", issue)?
        .into_iter()
        .find(|record| record.person.id == person_id && record.person.is_group)
        .ok_or(ApplicationError::MissingDeskRecord)?;
    let original = group
        .group_purchases
        .iter()
        .find(|purchase| {
            purchase.id == purchase_id
                && purchase.reversal_of.is_none()
                && !group
                    .group_purchases
                    .iter()
                    .any(|reversal| reversal.reversal_of.as_deref() == Some(purchase_id))
        })
        .ok_or(ApplicationError::NoPurchaseToCancel)?;
    let now = runtime.clock.now();
    let reversal = OneTimePurchase {
        id: runtime.ids.next_id(),
        purchased_at: now.clone(),
        created_at: now.clone(),
        updated_at: now,
        reversal_of: Some(original.id.clone()),
        note: Some("군지체 배부 취소".into()),
        ..original.clone()
    };
    let change = group_change(repository, runtime, &reversal, true)?;
    repository.save_purchase(&reversal, &change)?;
    Ok(())
}

fn group_change<R, C, I>(
    repository: &R,
    runtime: &RuntimeServices<'_, C, I>,
    record: &OneTimePurchase,
    reversal: bool,
) -> Result<ChangeLog, ApplicationError>
where
    R: DistributionDeskRepository,
    C: Clock,
    I: IdGenerator,
{
    let operator = repository
        .current_operator()?
        .filter(|name| !name.trim().is_empty())
        .ok_or(ApplicationError::MissingOperator)?;
    Ok(ChangeLog {
        id: runtime.ids.next_id(),
        occurred_at: record.created_at.clone(),
        operator_name: operator,
        action_type: if reversal {
            "group_distribution_reversed"
        } else {
            "group_distribution_recorded"
        }
        .into(),
        entity_type: "one_time_purchase".into(),
        entity_id: record.id.clone(),
        summary: format!(
            "군지체 {}권 {}",
            record.quantity,
            if reversal { "배부 취소" } else { "배부" }
        ),
        before_json: None,
        after_json: None,
    })
}
